import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PanoramaViewerComponent } from '../panorama/panorama-viewer.component';
import { TourRoom } from '../site-content';

// Mirrors the manifest shape in app.component.ts: `description` is optional
// because only described media carries one, and the title is the fallback.
type GalleryItem = { category: string; title: string; image: string; mediaType: 'image' | 'video'; description?: string };
export type GalleryMediaKind = 'photos' | 'videos' | 'tour';

@Component({
  selector: 'app-gallery',
  standalone: true,
  imports: [CommonModule, PanoramaViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gallery.component.html',
  styleUrl: './gallery.component.css'
})
export class GalleryComponent {
  @Input() visibleGallery: GalleryItem[] = [];
  @Input() activeMediaKind: GalleryMediaKind = 'photos';
  @Input() tourUrl = '';
  // Self-hosted fallback shown when tourUrl (an embed) isn't set -- see
  // PanoramaViewerComponent. May hold more than one room.
  @Input() panoramas: TourRoom[] = [];
  @Input() galleryLoading = true;
  @Input() galleryPrefetching = false;
  @Input() galleryPrefetchCount = 0;
  @Output() mediaKindChange = new EventEmitter<GalleryMediaKind>();
  @Output() mediaClick = new EventEmitter<GalleryItem>();
  @Output() mediaLoaded = new EventEmitter<void>();
  @Output() bookingClick = new EventEmitter<void>();

  readonly mediaKinds: { value: GalleryMediaKind; label: string }[] = [
    { value: 'tour', label: 'Virtual Tour' },
    { value: 'photos', label: 'Photos' },
    { value: 'videos', label: 'Videos' }
  ];

  constructor(private sanitizer: DomSanitizer) {}

  // Only HTTPS is ever written to content.tours (server-side validated), but
  // an iframe src is a resource-URL sink Angular sanitizes by default -- this
  // is what actually lets a trusted embed (Matterport/YouTube/etc.) load.
  get safeTourUrl(): SafeResourceUrl | null {
    if (!/^https:\/\//i.test(this.tourUrl)) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.tourUrl);
  }

  onMediaKindChange(kind: GalleryMediaKind) {
    this.mediaKindChange.emit(kind);
  }

  onMediaClick(image: GalleryItem) {
    this.mediaClick.emit(image);
  }

  onMediaLoaded() {
    this.mediaLoaded.emit();
  }

  onBookingClick() {
    this.bookingClick.emit();
  }

  trackByMediaKind(_: number, kind: { value: GalleryMediaKind; label: string }) {
    return kind.value;
  }

  trackByGalleryItem(_: number, item: GalleryItem) {
    return `${item.category}:${item.image}`;
  }
}
