import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { mediaUrl } from '../media-url';
import { SiteContent } from '../site-content';

type RateItem = SiteContent['rates']['items'][number];

@Component({
  selector: 'app-rates',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './rates.component.html',
  styleUrl: './rates.component.css'
})
export class RatesComponent {
  @Input({ required: true }) content!: SiteContent['rates'];
  @Output() contactClick = new EventEmitter<void>();

  // Empty until an admin uploads a rate schedule through the Site content
  // form (see AppComponent.uploadRatesDocument).
  get documentUrl(): string {
    return this.content.document ? mediaUrl(this.content.document) : '';
  }

  // Groups items under their shared `category` label (e.g. "All-Season Days"
  // vs "Special Community Events Only", matching the source pricing
  // schedule's own sections) while keeping items with no category ungrouped.
  // Group order follows each category's first appearance in `items`.
  get itemGroups(): { category: string; items: RateItem[] }[] {
    const groups: { category: string; items: RateItem[] }[] = [];
    for (const item of this.content.items) {
      const category = item.category || '';
      let group = groups.find(g => g.category === category);
      if (!group) {
        group = { category, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }

  onContactClick() {
    this.contactClick.emit();
  }
}
