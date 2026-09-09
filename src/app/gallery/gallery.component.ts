import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

// Mirrors the manifest shape in app.component.ts: `description` is optional
// because only described media carries one, and the title is the fallback.
type GalleryItem = { category: string; title: string; image: string; mediaType: 'image' | 'video'; description?: string };
export type GalleryMediaKind = 'photos' | 'videos' | 'tour';

@Component({
  selector: 'app-gallery',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gallery.component.html',
  styleUrl: './gallery.component.css'
})
export class GalleryComponent {
  @Input() visibleGallery: GalleryItem[] = [];
  @Input() activeGallery = 'Community Center';
  @Input() activeMediaKind: GalleryMediaKind = 'photos';
  @Input() tourUrl = '';
  @Input() galleryLoading = true;
  @Input() galleryPrefetching = false;
  @Input() galleryPrefetchCount = 0;
  @Output() categoryChange = new EventEmitter<string>();
  @Output() mediaKindChange = new EventEmitter<GalleryMediaKind>();
  @Output() mediaClick = new EventEmitter<GalleryItem>();
  @Output() mediaLoaded = new EventEmitter<void>();

  // The two areas of the venue a visitor can book, not the old photography
  // portfolio categories (Nature/Beach/etc.) this list used to hold.
  readonly categories = ['Community Center', 'Church'];
  readonly mediaKinds: { value: GalleryMediaKind; label: string }[] = [
    { value: 'photos', label: 'Photos' },
    { value: 'videos', label: 'Videos' },
    { value: 'tour', label: 'Virtual Tour' }
  ];

  constructor(private sanitizer: DomSanitizer) {}

  // Only HTTPS is ever written to content.tours (server-side validated), but
  // an iframe src is a resource-URL sink Angular sanitizes by default -- this
  // is what actually lets a trusted embed (Matterport/YouTube/etc.) load.
  get safeTourUrl(): SafeResourceUrl | null {
    if (!/^https:\/\//i.test(this.tourUrl)) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.tourUrl);
  }

  onCategoryChange(category: string) {
    this.categoryChange.emit(category);
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

  trackByCategory(_: number, category: string) {
    return category;
  }

  trackByMediaKind(_: number, kind: { value: GalleryMediaKind; label: string }) {
    return kind.value;
  }

  trackByGalleryItem(_: number, item: GalleryItem) {
    return `${item.category}:${item.image}`;
  }
}
