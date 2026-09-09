import { ChangeDetectionStrategy, Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { mediaUrl } from '../media-url';

@Component({
  selector: 'app-about',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './about.component.html',
  styleUrl: './about.component.css'
})
export class AboutComponent {
  @Output() contactClick = new EventEmitter<void>();

  readonly portraitImage = mediaUrl('assets/gallery/about/portrait-in-the-green-hills.jpg');

  onLearnMoreClick() {
    this.contactClick.emit();
  }
}
