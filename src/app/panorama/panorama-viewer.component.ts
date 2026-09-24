import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TourRoom } from '../site-content';

// The Pannellum global, loaded on demand from /assets/pannellum (copied from
// node_modules by angular.json) the first time a 360 room is opened, so the
// ~55KB script never costs anything for venues that only use flat panoramas.
declare const pannellum: any;
let pannellumLoad: Promise<void> | null = null;
function loadPannellum(): Promise<void> {
  if ((window as any).pannellum) return Promise.resolve();
  if (pannellumLoad) return pannellumLoad;
  pannellumLoad = new Promise<void>((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'assets/pannellum/pannellum.css';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = 'assets/pannellum/pannellum.js';
    script.onload = () => resolve();
    script.onerror = () => { pannellumLoad = null; reject(new Error('Could not load the 360 viewer.')); };
    document.head.appendChild(script);
  });
  return pannellumLoad;
}

// A room-by-room virtual tour. Two kinds of photo are supported per room:
//  - 'flat' (default): a phone "panorama" capture tagged
//    GPano:ProjectionType="cylindrical" at roughly 90 degrees of horizontal
//    field of view -- not a full sphere -- so a flat, clamped drag/pinch/zoom
//    over the image reads correctly without true projection math (the
//    curvature a real 360 viewer corrects for is only visible near the
//    image's own edges at this FOV).
//  - '360': a full equirectangular photo, shown in Pannellum.
// Rooms can carry hotspots (jump to another room), layout variants of the same
// room, a description/capacity, and a "check availability" call to action. The
// active room is mirrored into the URL as `#tour=<room id>` so it can be shared.
@Component({
  selector: 'app-panorama-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './panorama-viewer.component.html',
  styleUrl: './panorama-viewer.component.css'
})
export class PanoramaViewerComponent implements OnChanges, AfterViewInit, OnDestroy {
  // Room images (and layout images) here are already resolved to full URLs.
  @Input({ required: true }) rooms: TourRoom[] = [];
  @Output() bookNow = new EventEmitter<void>();

  @ViewChild('viewport', { static: true }) viewportRef!: ElementRef<HTMLDivElement>;
  @ViewChild('image', { static: true }) imageRef!: ElementRef<HTMLImageElement>;
  @ViewChild('sphere', { static: true }) sphereRef!: ElementRef<HTMLDivElement>;

  activeRoomIndex = 0;
  // -1 is the room's own photo; >= 0 selects one of room.layouts.
  activeLayoutIndex = -1;
  loading = true;
  loadError = false;
  linkCopied = false;

  private naturalWidth = 0;
  private naturalHeight = 0;
  // The zoom level that exactly fills the viewport's height -- the "zoomed
  // all the way out" baseline, since panning left/right is the point.
  private minZoom = 1;
  zoom = 1;
  offsetX = 0;
  offsetY = 0;
  dragging = false;
  hasInteracted = false;

  // Active pointers, for one-finger drag vs two-finger pinch.
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private lastMoveTime = 0;
  private velocityX = 0;
  private velocityY = 0;
  private inertiaFrame = 0;
  private resizeObserver?: ResizeObserver;
  private viewer: any = null;
  private viewerToken = 0;
  // How the current photo is being shown; only meaningful once `resolved`.
  resolvedMode: 'flat' | 'partial' | '360' = 'flat';
  resolved = false;
  imageRatio = 2;
  private flatFallbackUrl = '';
  private roomsSignature = '';
  private preloaded = false;
  private copyTimer?: ReturnType<typeof setTimeout>;

  constructor(private changeDetector: ChangeDetectorRef) {}

  get room(): TourRoom | undefined {
    return this.rooms[this.activeRoomIndex];
  }

  get imageUrl(): string {
    const room = this.room;
    if (!room) return '';
    return (this.activeLayoutIndex >= 0 && room.layouts?.[this.activeLayoutIndex]?.image) || room.image || '';
  }

  // Bound to the <img>: empty unless the flat viewer is in use, so it doesn't
  // download a photo the Pannellum viewer is already showing.
  get flatUrl(): string {
    return this.sphereMode || !this.resolved ? '' : this.imageUrl;
  }

  // Rendered through Pannellum (partial or full 360) rather than the flat viewer.
  get sphereMode(): boolean {
    return this.resolvedMode !== 'flat';
  }

  // Wide panoramas get a wider frame so they aren't letterboxed into 16:9.
  get frameAspect(): string | null {
    if (!this.resolved || this.resolvedMode === '360' || this.imageRatio <= 1.9) return null;
    return String(Math.min(2.2, this.imageRatio));
  }

  get alt(): string {
    const label = this.room?.label;
    return label ? `Panoramic view of ${label}` : 'Panoramic view of the venue';
  }

  get showRoomPicker(): boolean {
    return this.rooms.length > 1;
  }

  roomLabel(id: string): string {
    return this.rooms.find(r => r.id === id)?.label || '';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['rooms']) return;
    // The parent hands over a freshly built array on every change-detection
    // pass, so `rooms` looks "changed" constantly. Only rebuild the viewer
    // when the tour's actual content differs, or it would restart forever.
    const signature = JSON.stringify(this.rooms);
    if (signature === this.roomsSignature) return;
    this.roomsSignature = signature;
    // Open on the room named in the URL hash (`#tour=<id>`) if there is one.
    const wanted = /^#tour=(.+)$/.exec(window.location.hash)?.[1];
    const index = wanted ? this.rooms.findIndex(r => r.id === decodeURIComponent(wanted)) : -1;
    this.activeRoomIndex = index >= 0 ? index : Math.min(this.activeRoomIndex, Math.max(0, this.rooms.length - 1));
    this.activeLayoutIndex = -1;
    this.enterRoom();
  }

  ngAfterViewInit(): void {
    // Zoom limits depend on the viewport's size, so a resize/rotate has to
    // recompute them (keeping the visitor's relative zoom) or the framing goes
    // stale.
    if (typeof ResizeObserver !== 'undefined') {
      let lastWidth = this.viewportRef.nativeElement.clientWidth;
      let lastHeight = this.viewportRef.nativeElement.clientHeight;
      this.resizeObserver = new ResizeObserver(() => {
        const el = this.viewportRef.nativeElement;
        if (el.clientWidth === lastWidth && el.clientHeight === lastHeight) return;
        lastWidth = el.clientWidth;
        lastHeight = el.clientHeight;
        if (this.sphereMode || !this.naturalHeight || !el.clientHeight) return;
        const relative = this.zoom / this.minZoom;
        this.minZoom = el.clientHeight / this.naturalHeight;
        this.zoom = Math.min(this.minZoom * 3, Math.max(this.minZoom, this.minZoom * relative));
        this.clamp();
        this.changeDetector.markForCheck();
      });
      this.resizeObserver.observe(this.viewportRef.nativeElement);
    }
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.inertiaFrame);
    this.resizeObserver?.disconnect();
    clearTimeout(this.copyTimer);
    this.destroyViewer();
  }

  selectRoom(index: number, layoutIndex = -1): void {
    if (index === this.activeRoomIndex && layoutIndex === this.activeLayoutIndex) return;
    this.activeRoomIndex = index;
    this.activeLayoutIndex = layoutIndex;
    this.hasInteracted = false;
    this.linkCopied = false;
    this.enterRoom();
    this.syncHash();
  }

  selectRoomById(id: string): void {
    const index = this.rooms.findIndex(r => r.id === id);
    if (index >= 0) this.selectRoom(index);
  }

  selectLayout(layoutIndex: number): void {
    this.selectRoom(this.activeRoomIndex, layoutIndex);
  }

  // Called whenever the displayed photo changes. Shows the spinner, measures
  // the photo (needed to tell a full sphere from a partial phone panorama from
  // a plain photo when the room is on 'auto', and to infer a partial
  // panorama's field of view when there's no GPano metadata), then hands off
  // to the Pannellum viewer or the flat one. The flat viewer finishes in
  // onImageLoad(), which also re-frames pan/zoom for the new photo.
  private enterRoom(): void {
    cancelAnimationFrame(this.inertiaFrame);
    const token = ++this.viewerToken;
    const url = this.imageUrl;
    this.loading = true;
    this.loadError = false;
    this.resolved = false;
    this.destroyViewer();
    this.changeDetector.markForCheck();
    if (!url) return;

    const probe = new Image();
    probe.onload = () => {
      if (token !== this.viewerToken) return;
      this.imageRatio = probe.naturalWidth / (probe.naturalHeight || 1);
      this.applyMode(token, url);
    };
    probe.onerror = () => {
      if (token !== this.viewerToken) return;
      this.loading = false;
      this.loadError = true;
      this.changeDetector.markForCheck();
    };
    probe.src = url;
  }

  private applyMode(token: number, url: string): void {
    const requested = this.room?.mode || 'auto';
    let mode: 'flat' | 'partial' | '360' | 'auto' = requested;
    if (mode === 'auto') {
      // A full equirectangular sphere is exactly 2:1. Anything meaningfully
      // wider is a phone panorama; anything narrower is an ordinary photo.
      mode = Math.abs(this.imageRatio - 2) < 0.06 ? '360' : this.imageRatio > 2.06 ? 'partial' : 'flat';
    }
    // WebGL failed for this photo before -- stay on the flat viewer.
    if (this.flatFallbackUrl === url) mode = 'flat';

    this.resolvedMode = mode;
    this.resolved = true;
    this.changeDetector.detectChanges();
    if (mode === 'flat') {
      // If the <img> already has this src (same photo re-entered) no load
      // event will fire, so finish here.
      const img = this.imageRef.nativeElement;
      if (img.complete && img.naturalWidth && img.getAttribute('src') === url) this.onImageLoad();
    } else {
      void this.mountSphere(token, mode, url);
    }
  }

  // Yaw/pitch extent of the photo, in degrees, for the Pannellum viewer.
  private sphereGeometry(mode: 'partial' | '360'): { haov: number; vaov: number; vOffset: number } {
    const room = this.room!;
    if (mode === '360') return { haov: 360, vaov: 180, vOffset: 0 };
    // Phone panoramas keep a constant pixels-per-degree, so without metadata
    // the width follows from the shape assuming a typical ~37 degree height.
    const vaov = Math.min(180, room.vaov ?? 37);
    const haov = Math.min(360, room.haov ?? Math.min(340, this.imageRatio * vaov));
    return { haov, vaov, vOffset: room.vOffset ?? 0 };
  }

  private async mountSphere(token: number, mode: 'partial' | '360', url: string): Promise<void> {
    try {
      // Pannellum uploads the photo to WebGL, which browsers only allow for
      // cross-origin images served with CORS headers (e.g. a media bucket
      // without a CORS rule). Check first and use the flat viewer, which
      // needs no CORS, rather than let Pannellum fail noisily.
      if (new URL(url, window.location.href).origin !== window.location.origin) {
        await fetch(url, { method: 'HEAD', mode: 'cors' });
      }
      await loadPannellum();
    } catch {
      if (token === this.viewerToken) this.fallBackToFlat(url);
      return;
    }
    // A later room change won the race while the script was loading.
    if (token !== this.viewerToken) return;
    const room = this.room!;
    const { haov, vaov, vOffset } = this.sphereGeometry(mode);
    // Hotspots are stored as image-percent; convert to the yaw/pitch the
    // photo covers (centred on yaw 0, and on vOffset degrees of pitch).
    const hotSpots = (room.hotspots || []).map(spot => ({
      type: 'custom',
      yaw: (spot.x / 100 - 0.5) * haov,
      pitch: vOffset + (0.5 - spot.y / 100) * vaov,
      cssClass: 'pano360-hotspot',
      text: spot.label || this.roomLabel(spot.toRoom) || 'Go to room',
      clickHandlerFunc: () => { this.selectRoomById(spot.toRoom); this.changeDetector.markForCheck(); }
    }));
    const full = haov >= 359;
    try {
      this.viewer = pannellum.viewer(this.sphereRef.nativeElement, {
        type: 'equirectangular',
        panorama: url,
        autoLoad: true,
        showControls: true,
        compass: false,
        haov,
        vaov,
        vOffset,
        yaw: 0,
        pitch: vOffset,
        // Pannellum narrows the allowed zoom itself so a partial panorama
        // never shows past its own edges.
        hfov: full ? 100 : Math.min(70, haov),
        minHfov: 30,
        maxHfov: full ? 120 : haov,
        hotSpots
      });
    } catch {
      this.fallBackToFlat(url);
      return;
    }
    this.viewer.on('load', () => { this.loading = false; this.hasInteracted = false; this.changeDetector.markForCheck(); });
    // Typically no WebGL, or a photo bigger than the device's max texture:
    // the flat viewer still works for both.
    this.viewer.on('error', () => this.fallBackToFlat(url));
    this.viewer.on('mousedown', () => { this.hasInteracted = true; this.changeDetector.markForCheck(); });
    this.viewer.on('touchstart', () => { this.hasInteracted = true; this.changeDetector.markForCheck(); });
  }

  private fallBackToFlat(url: string): void {
    if (this.imageUrl !== url) return;
    this.flatFallbackUrl = url;
    this.enterRoom();
  }

  private destroyViewer(): void {
    try { this.viewer?.destroy(); } catch { /* already torn down */ }
    this.viewer = null;
  }

  private syncHash(): void {
    const id = this.room?.id;
    if (!id) return;
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#tour=${encodeURIComponent(id)}`);
    } catch { /* history unavailable (sandboxed frame) -- sharing just won't work */ }
  }

  async copyLink(): Promise<void> {
    this.syncHash();
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.linkCopied = true;
    } catch {
      window.prompt('Copy this link:', window.location.href);
    }
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => { this.linkCopied = false; this.changeDetector.markForCheck(); }, 2000);
    this.changeDetector.markForCheck();
  }

  onBookNow(): void {
    this.bookNow.emit();
  }

  get displayWidth(): number {
    return this.naturalWidth * this.zoom;
  }

  get displayHeight(): number {
    return this.naturalHeight * this.zoom;
  }

  onImageLoad(): void {
    const img = this.imageRef.nativeElement;
    if (!img.getAttribute('src')) return;
    this.naturalWidth = img.naturalWidth;
    this.naturalHeight = img.naturalHeight;
    this.loading = false;
    this.loadError = false;
    this.resetView();
    this.preloadOtherRooms();
  }

  onImageError(): void {
    if (!this.imageRef.nativeElement.getAttribute('src')) return;
    this.loading = false;
    this.loadError = true;
  }

  // Once the first photo is up, quietly fetch the rest so switching rooms is
  // instant. 360 rooms are large, so only flat rooms are preloaded.
  private preloadOtherRooms(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    for (const room of this.rooms) {
      if (room.mode === '360' || !room.image) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = room.image;
    }
  }

  resetView(): void {
    cancelAnimationFrame(this.inertiaFrame);
    const viewport = this.viewportRef.nativeElement;
    const viewportHeight = viewport.clientHeight || 1;
    this.minZoom = this.naturalHeight ? viewportHeight / this.naturalHeight : 1;
    this.zoom = this.minZoom;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  // Pointer handling: one pointer drags (with inertia on release), two pinch.
  // Presses that start on a hotspot or control are left alone so they still
  // register as clicks.
  onPointerDown(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest('button')) return;
    cancelAnimationFrame(this.inertiaFrame);
    this.hasInteracted = true;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.viewportRef.nativeElement.setPointerCapture(event.pointerId);
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.velocityX = this.velocityY = 0;
      this.lastMoveTime = event.timeStamp;
    } else if (this.pointers.size === 2) {
      this.dragging = false;
      this.pinchDistance = this.currentPinchDistance();
    }
  }

  onPointerMove(event: PointerEvent): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, point);

    if (this.pointers.size >= 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0 && distance > 0) this.setZoom(this.zoom * (distance / this.pinchDistance));
      this.pinchDistance = distance;
      return;
    }

    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    this.offsetX += dx;
    this.offsetY += dy;
    const dt = Math.max(1, event.timeStamp - this.lastMoveTime);
    // Smoothed px/ms so a single jittery sample doesn't set the fling speed.
    this.velocityX = this.velocityX * 0.4 + (dx / dt) * 0.6;
    this.velocityY = this.velocityY * 0.4 + (dy / dt) * 0.6;
    this.lastMoveTime = event.timeStamp;
    this.clamp();
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) return;
    this.pinchDistance = 0;
    if (this.pointers.size === 1) {
      // Pinch ended with one finger still down: carry on dragging from there.
      this.dragging = true;
      this.velocityX = this.velocityY = 0;
      return;
    }
    this.dragging = false;
    // Only coast if the finger was still moving when released.
    if (event.timeStamp - this.lastMoveTime < 80 && Math.hypot(this.velocityX, this.velocityY) > 0.05) this.startInertia();
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private startInertia(): void {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      this.offsetX += this.velocityX * dt;
      this.offsetY += this.velocityY * dt;
      // Exponential decay, tuned to a ~0.5s glide.
      const decay = Math.pow(0.995, dt);
      this.velocityX *= decay;
      this.velocityY *= decay;
      const beforeX = this.offsetX;
      const beforeY = this.offsetY;
      this.clamp();
      // Hitting an edge kills the momentum on that axis.
      if (this.offsetX !== beforeX) this.velocityX = 0;
      if (this.offsetY !== beforeY) this.velocityY = 0;
      this.changeDetector.markForCheck();
      if (Math.hypot(this.velocityX, this.velocityY) > 0.01) this.inertiaFrame = requestAnimationFrame(step);
    };
    this.inertiaFrame = requestAnimationFrame(step);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.hasInteracted = true;
    this.setZoom(this.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
  }

  // The viewport is focusable, so the tour is usable without a mouse.
  onKeydown(event: KeyboardEvent): void {
    const step = 60;
    switch (event.key) {
      case 'ArrowLeft': this.offsetX += step; break;
      case 'ArrowRight': this.offsetX -= step; break;
      case 'ArrowUp': this.offsetY += step; break;
      case 'ArrowDown': this.offsetY -= step; break;
      case '+': case '=': this.setZoom(this.zoom * 1.3); break;
      case '-': case '_': this.setZoom(this.zoom / 1.3); break;
      case '0': case 'Home': this.resetView(); break;
      default: return;
    }
    event.preventDefault();
    this.hasInteracted = true;
    this.clamp();
  }

  zoomIn(): void {
    this.hasInteracted = true;
    this.setZoom(this.zoom * 1.3);
  }

  zoomOut(): void {
    this.hasInteracted = true;
    this.setZoom(this.zoom / 1.3);
  }

  private setZoom(next: number): void {
    const maxZoom = this.minZoom * 3;
    this.zoom = Math.min(maxZoom, Math.max(this.minZoom, next));
    this.clamp();
  }

  private clamp(): void {
    const viewport = this.viewportRef?.nativeElement;
    if (!viewport) return;
    const maxX = Math.max(0, (this.displayWidth - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (this.displayHeight - viewport.clientHeight) / 2);
    this.offsetX = Math.min(maxX, Math.max(-maxX, this.offsetX));
    this.offsetY = Math.min(maxY, Math.max(-maxY, this.offsetY));
  }

  get imageTransform(): string {
    return `translate(calc(-50% + ${this.offsetX}px), calc(-50% + ${this.offsetY}px))`;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
