import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getApiBaseUrl } from '../media-url';

export type ServiceTier = { label: string; price: string; details: string };
export type ServiceAddon = { label: string; price: string; details: string };
export type Service = {
  name: string;
  icon: string;
  title: string;
  text: string;
  image: string;
  mediaType?: 'image' | 'video';
  poster?: string;
  pricingTitle: string;
  tiers: ServiceTier[];
  addons: ServiceAddon[];
};

@Component({
  selector: 'app-services',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './services.component.html',
  styleUrl: './services.component.css'
})
export class ServicesComponent implements OnChanges {
  @Input() services: Service[] = [];
  @Input() activeService = 'Aerial';
  @Input() aerialVideos: string[] = [];
  @Output() serviceChange = new EventEmitter<string>();
  @Output() contactClick = new EventEmitter<void>();
  contact = { name: '', email: '', service: 'Aerial', message: '' };
  submitting = false;
  formSuccess = '';
  formError = '';
  private readonly api = getApiBaseUrl();
  private aerialVideoIndex = 0;

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['aerialVideos']) return;
    if (!this.aerialVideos.length) {
      this.aerialVideoIndex = 0;
      return;
    }
    this.aerialVideoIndex %= this.aerialVideos.length;
  }

  onServiceChange(serviceName: string) {
    this.serviceChange.emit(serviceName);
  }

  onLearnMoreClick() {
    this.contactClick.emit();
  }

  canCycleAerialVideos(service: Service) {
    return service.name === 'Aerial' && this.aerialVideos.length > 1;
  }

  getAerialVideoPosition() {
    return this.aerialVideoIndex + 1;
  }

  getAerialVideoTotal() {
    return this.aerialVideos.length;
  }

  getServiceMediaSource(service: Service) {
    if (service.name !== 'Aerial' || !this.aerialVideos.length) return service.image;
    return this.aerialVideos[this.aerialVideoIndex];
  }

  showPreviousAerialVideo() {
    if (this.aerialVideos.length < 2) return;
    this.aerialVideoIndex = (this.aerialVideoIndex - 1 + this.aerialVideos.length) % this.aerialVideos.length;
  }

  showNextAerialVideo() {
    if (this.aerialVideos.length < 2) return;
    this.aerialVideoIndex = (this.aerialVideoIndex + 1) % this.aerialVideos.length;
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (!this.canCycleActiveAerialVideos()) return;
    if (this.isTypingTarget(event.target)) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.showPreviousAerialVideo();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.showNextAerialVideo();
    }
  }

  private canCycleActiveAerialVideos() {
    return this.activeService === 'Aerial' && this.aerialVideos.length > 1;
  }

  private isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest('input, textarea, select, [contenteditable="true"]');
  }

  async onSubmitContact() {
    this.formError = '';
    this.formSuccess = '';
    this.submitting = true;
    try {
      const response = await fetch(`${this.api}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.contact)
      });
      const body = await response.json();
      if (!response.ok) {
        this.formError = body.error || 'Could not send your inquiry right now.';
        this.submitting = false;
        return;
      }
      this.formSuccess = 'Thanks. Your inquiry has been sent. We will respond shortly.';
      this.contact = { name: '', email: '', service: this.services[0]?.name || 'Aerial', message: '' };
    } catch {
      this.formError = 'Network error. Please try again in a moment.';
    }
    this.submitting = false;
  }
}
