import { ChangeDetectionStrategy, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

// A drag-to-pan, scroll/pinch-to-zoom viewer for a single wide panorama
// photo. The source photos are phone "panorama" captures tagged
// GPano:ProjectionType="cylindrical" at roughly 90 degrees of horizontal
// field of view -- not a full 360 sphere -- so a flat, clamped pan/zoom over
// the image reads correctly at this FOV without needing true cylindrical
// projection math (the curvature a real 360 viewer would correct for is
// only really visible near the image's own edges here).
@Component({
  selector: 'app-panorama-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './panorama-viewer.component.html',
  styleUrl: './panorama-viewer.component.css'
})
export class PanoramaViewerComponent {
  @Input({ required: true }) imageUrl!: string;
  @Input() alt = 'Panoramic view of the venue';

  @ViewChild('viewport', { static: true }) viewportRef!: ElementRef<HTMLDivElement>;
  @ViewChild('image', { static: true }) imageRef!: ElementRef<HTMLImageElement>;

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

  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;

  get displayWidth(): number {
    return this.naturalWidth * this.zoom;
  }

  get displayHeight(): number {
    return this.naturalHeight * this.zoom;
  }

  onImageLoad(): void {
    const img = this.imageRef.nativeElement;
    this.naturalWidth = img.naturalWidth;
    this.naturalHeight = img.naturalHeight;
    this.resetView();
  }

  resetView(): void {
    const viewport = this.viewportRef.nativeElement;
    const viewportHeight = viewport.clientHeight || 1;
    this.minZoom = this.naturalHeight ? viewportHeight / this.naturalHeight : 1;
    this.zoom = this.minZoom;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  onPointerDown(event: PointerEvent): void {
    this.dragging = true;
    this.hasInteracted = true;
    this.pointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    this.offsetX += event.clientX - this.lastX;
    this.offsetY += event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.clamp();
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.hasInteracted = true;
    this.setZoom(this.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
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
}
