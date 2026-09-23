import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** The sanitized view the server returns for a customer's own booking (see publicBookingView in fairviewApi/server.js). */
export type BookingLookupResult = {
  id: string;
  confirmationCode: string;
  date: string;
  status: string;
  agreedTime: string;
  name: string;
  email: string;
  eventDescription: string;
  guestCount: string | number;
  packageName: string;
  addOns: { name: string; priceCents: number }[];
  sessionFee: number;
  deposit: number;
  balanceDue: number;
  balancePaid: boolean;
  agreementSigned: boolean;
  refundPolicy: string;
  refundable: boolean;
};

@Component({
  selector: 'app-booking-lookup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './booking-lookup.component.html',
  styleUrl: './booking-lookup.component.css'
})
export class BookingLookupComponent {
  @Input() loading = false;
  @Input() error = '';
  @Input() result: BookingLookupResult | null = null;
  @Input() signSubmitting = false;
  @Input() payBalanceSubmitting = false;
  @Input() agreementHref = '';
  @Input() icsHref = '';

  @Output() lookup = new EventEmitter<{ email: string; confirmationCode: string }>();
  @Output() signAgreement = new EventEmitter<string>();
  @Output() payBalance = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();

  form = { email: '', confirmationCode: '' };
  signerName = '';

  submitLookup() {
    const email = this.form.email.trim();
    const confirmationCode = this.form.confirmationCode.trim();
    if (!email || !confirmationCode) return;
    this.lookup.emit({ email, confirmationCode });
  }

  submitSignature() {
    const name = this.signerName.trim();
    if (name.length < 2 || this.signSubmitting) return;
    this.signAgreement.emit(name);
  }

  startOver() {
    this.form = { email: '', confirmationCode: '' };
    this.signerName = '';
    this.reset.emit();
  }

  money(cents: number): string {
    return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
  }
}
