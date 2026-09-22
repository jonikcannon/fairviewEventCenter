import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { mediaUrl } from '../media-url';
import { SiteContent } from '../site-content';
import { TextStyles, textStyle } from '../text-style';

@Component({
  selector: 'app-about',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './about.component.html',
  styleUrl: './about.component.css'
})
export class AboutComponent {
  @Input({ required: true }) content!: SiteContent['about'];
  @Input() textStyles: TextStyles | undefined;
  @Output() contactClick = new EventEmitter<void>();
  @Output() ratesClick = new EventEmitter<void>();
  @Output() bookingClick = new EventEmitter<void>();
  @Output() featureClick = new EventEmitter<{ title: string; image: string; description?: string }>();

  // The bundled default until an admin uploads a real portrait through the
  // admin panel's Site content form.
  private readonly defaultPortraitImage = mediaUrl('assets/gallery/about/20260909_190229.jpg');

  get portraitImage(): string {
    return this.content.portraitImage ? mediaUrl(this.content.portraitImage) : this.defaultPortraitImage;
  }

  // Stored as one field with paragraphs separated by a blank line, so the
  // admin form is a single textarea rather than an add/remove-paragraph UI.
  get bodyParagraphs(): string[] {
    return this.content.body.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  }

  // Unlike the portrait, a feature has no bundled default image -- an admin
  // may leave it off entirely, so this returns '' rather than a fallback.
  featureImage(image: string): string {
    return image ? mediaUrl(image) : '';
  }

  // Falls back to [] for content saved before this field existed -- app.ts's
  // content load is a shallow merge onto defaultSiteContent, so an `about`
  // object from an older schema arrives here with no `features` key at all.
  get features(): SiteContent['about']['features'] {
    return this.content.features || [];
  }

  style(key: string) {
    return textStyle(this.textStyles, key);
  }

  onLearnMoreClick() {
    this.contactClick.emit();
  }

  onRatesClick() {
    this.ratesClick.emit();
  }

  onBookingClick() {
    this.bookingClick.emit();
  }

  onFeatureClick(feature: SiteContent['about']['features'][number]) {
    const image = this.featureImage(feature.image);
    if (!image) return;
    this.featureClick.emit({ title: feature.title, image, description: feature.description });
  }
}
