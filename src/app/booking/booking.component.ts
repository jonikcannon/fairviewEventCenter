import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type BookingSlot = {
  id: string;
  /** Calendar day, YYYY-MM-DD. Bookings are whole days: at most one slot exists per date. */
  date: string;
  location: string;
  /** All money is in cents, matching the API. Always the flat event-space rate. */
  sessionFee: number;
  deposit: number;
  balanceDue: number;
};

export type BookingRequest = {
  slotId: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  address: string;
  eventDescription: string;
  guestCount: string;
};

/**
 * A date with no slot yet, reserved on request. There is no existing slot to
 * hold against, so the server creates one on demand at the flat event-space
 * rate -- but the checkout itself is the same Stripe deposit flow as booking
 * a date that already has a slot.
 */
export type BookingDateRequest = {
  date: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  address: string;
  eventDescription: string;
  guestCount: string;
};

@Component({
  selector: 'app-booking',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './booking.component.html',
  styleUrl: './booking.component.css'
})
export class BookingComponent {
  @Input() slots: BookingSlot[] = [];
  // Dates that are actually taken (booked, or held while someone is paying a
  // deposit right now) -- the only thing that should ever disable a day.
  // Days are open by default; a missing entry here just means nobody has
  // booked it, not that it isn't offered.
  @Input() bookedDates: string[] = [];
  // Recurring weekly closures, as JS weekday numbers (0=Sun..6=Sat), plus
  // specific dates that are exceptions to them.
  @Input() closedWeekdays: number[] = [];
  @Input() unblockedDates: string[] = [];
  @Input() loading = false;
  @Input() submitting = false;
  @Input() error = '';
  @Input() refundPolicy = '';
  @Input() holdMinutes = 15;
  @Input() requestSubmitting = false;
  @Output() book = new EventEmitter<BookingRequest>();
  @Output() enquire = new EventEmitter<void>();
  @Output() requestDate = new EventEmitter<BookingDateRequest>();

  selectedSlotId = '';
  calendarMonth = this.firstOfMonth(new Date());
  formError = '';
  // address/eventDescription/guestCount feed the Rental Agreement generated
  // once the reservation fee is paid (see fairviewApi/rentalAgreement.js) --
  // not used anywhere else in the booking flow.
  form = { name: '', email: '', phone: '', notes: '', address: '', eventDescription: '', guestCount: '' };

  requestDateInput = '';
  requestForm = { name: '', email: '', phone: '', notes: '', address: '', eventDescription: '', guestCount: '' };

  // Nothing has a slot anywhere yet. Only drives the "No days are open..."
  // banner text; it no longer gates whether a date is clickable (see
  // calendarDays below) -- every day is bookable by default regardless.
  get isEmpty(): boolean {
    return !this.slots.length;
  }

  get selectedSlot(): BookingSlot | null {
    return this.slots.find(slot => slot.id === this.selectedSlotId) || null;
  }

  // Drives the plain "Choose a date" input: whatever day is currently picked,
  // either as a real open slot or as a request-this-date draft.
  get selectedDateValue(): string {
    return this.selectedSlot?.date || this.requestDateInput || '';
  }

  get todayDateValue(): string {
    return this.toDateKey(new Date());
  }

  get calendarMonthLabel(): string {
    return this.parseDay(this.toDateKey(this.calendarMonth)).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  // True when a recurring weekly closure covers this date and nothing
  // unblocks it -- mirrors isBlocked() in fairviewApi/booking.js exactly, off
  // the public-safe closedWeekdays/unblockedDates inputs.
  isDateClosed(date: string): boolean {
    if (this.unblockedDates.includes(date)) return false;
    return this.closedWeekdays.includes(this.parseDay(date).getDay());
  }

  isDateBooked(date: string): boolean {
    return this.bookedDates.includes(date);
  }

  get calendarDays(): Array<{ date: string | null; inMonth: boolean; slot: BookingSlot | null; available: boolean; requestable: boolean; unavailable: boolean; selected: boolean }> {
    const monthStart = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth(), 1);
    const firstWeekDay = monthStart.getDay();
    const start = new Date(monthStart);
    start.setDate(monthStart.getDate() - firstWeekDay);
    const days: Array<{ date: string | null; inMonth: boolean; slot: BookingSlot | null; available: boolean; requestable: boolean; unavailable: boolean; selected: boolean }> = [];
    const today = this.todayDateValue;

    for (let index = 0; index < 42; index += 1) {
      const current = new Date(start);
      current.setDate(start.getDate() + index);
      const dateKey = this.toDateKey(current);
      const slot = this.slots.find(entry => entry.date === dateKey) || null;
      // A slot already exists for this date (someone has held, requested, or
      // been manually booked into it before) -- always bookable at the flat rate.
      const available = !!slot;
      const isPast = dateKey < today;
      const taken = this.isDateBooked(dateKey) || this.isDateClosed(dateKey);
      days.push({
        date: dateKey,
        inMonth: current.getMonth() === monthStart.getMonth(),
        slot,
        available,
        // Days are open by default: anything not already booked, closed, or
        // in the past is bookable via the "request this date" flow, which
        // creates the slot on demand at the flat event-space rate.
        requestable: !available && !taken && !isPast,
        unavailable: isPast || taken,
        selected: this.selectedDateValue === dateKey
      });
    }
    return days;
  }

  // Scoped to whatever month the calendar above is currently showing, so the
  // scrollable strip stays in sync with the ← / → month nav instead of always
  // listing every booked day site-wide. bookedDates carries no price or
  // customer info (see the input's doc comment) -- only the date -- which is
  // exactly right for a read-only "here's what's taken" reference; there is
  // nothing to click into.
  get monthBookedDates(): string[] {
    const year = this.calendarMonth.getFullYear();
    const month = this.calendarMonth.getMonth();
    return this.bookedDates
      .filter(date => {
        const day = this.parseDay(date);
        return day.getFullYear() === year && day.getMonth() === month;
      })
      .sort((left, right) => left.localeCompare(right));
  }

  // Dates are plain calendar days. Parsing them as local time avoids the
  // off-by-one that `new Date('2026-09-01')` causes by treating it as UTC.
  parseDay(date: string): Date {
    const [year, month, day] = String(date).split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Anchored to day 1 so `setMonth` can never overflow into the wrong month --
  // e.g. a Jan 31 anchor plus one month rolls over to Mar 3 in plain JS Date math.
  private firstOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  formatDay(date: string): string {
    return this.parseDay(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  formatMonth(date: string): string {
    return this.parseDay(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  money(cents: number): string {
    return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
  }

  shiftCalendarMonth(offset: number) {
    this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + offset, 1);
  }

  // Picking an open day goes straight to the deposit form -- a day is the
  // whole bookable unit now, so there is no intermediate time-of-day step.
  selectCalendarDate(day: { date: string | null; slot: BookingSlot | null; requestable: boolean }) {
    if (!day.date) return;
    if (day.slot) {
      this.select(day.slot);
      return;
    }
    if (day.requestable) {
      this.selectRequestDate(day.date);
      return;
    }
    this.formError = 'That date is not available for bookings yet.';
  }

  selectDateInput(date: string) {
    this.formError = '';
    if (!date) {
      this.clearDate();
      return;
    }
    this.calendarMonth = this.firstOfMonth(this.parseDay(date));
    const slot = this.slots.find(entry => entry.date === date);
    if (slot) {
      this.select(slot);
      return;
    }
    this.selectedSlotId = '';
    const isTaken = this.isDateBooked(date) || this.isDateClosed(date);
    if (!isTaken && date >= this.todayDateValue) {
      this.selectRequestDate(date);
      return;
    }
    this.requestDateInput = '';
    this.formError = 'That date is not available.';
  }

  // Opens the "request this date" form -- used both from the calendar grid and
  // the plain date input, so both agree on when a request is even offered
  // (not booked, not closed, not in the past).
  selectRequestDate(date: string) {
    this.formError = '';
    this.selectedSlotId = '';
    this.requestDateInput = date;
    this.calendarMonth = this.firstOfMonth(this.parseDay(date));
  }

  cancelRequest() {
    this.requestDateInput = '';
    this.formError = '';
  }

  submitRequest() {
    if (!this.requestDateInput || this.requestSubmitting) return;
    const name = this.requestForm.name.trim();
    const email = this.requestForm.email.trim();
    if (name.length < 2) {
      this.formError = 'Please enter your name.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.formError = 'Please enter a valid email address.';
      return;
    }
    this.formError = '';
    // Not cleared here: this is a paid checkout redirect, not a fire-and-forget
    // lead, so on failure the parent leaves this component's inputs unchanged
    // and the visitor's entries stay on screen to retry rather than vanishing.
    this.requestDate.emit({
      date: this.requestDateInput,
      name,
      email,
      phone: this.requestForm.phone.trim(),
      notes: this.requestForm.notes.trim(),
      address: this.requestForm.address.trim(),
      eventDescription: this.requestForm.eventDescription.trim(),
      guestCount: this.requestForm.guestCount.trim()
    });
  }

  select(slot: BookingSlot) {
    this.selectedSlotId = slot.id;
    this.requestDateInput = '';
    this.formError = '';
  }

  // Drops back to the calendar rather than clearing the month: someone
  // changing their mind usually wants a different day nearby, not to start
  // browsing from scratch.
  cancel() {
    this.selectedSlotId = '';
    this.formError = '';
  }

  clearDate() {
    this.selectedSlotId = '';
    this.requestDateInput = '';
    this.formError = '';
  }

  submit() {
    const slot = this.selectedSlot;
    if (!slot || this.submitting) return;
    const name = this.form.name.trim();
    const email = this.form.email.trim();
    if (name.length < 2) {
      this.formError = 'Please enter your name.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.formError = 'Please enter a valid email address.';
      return;
    }
    this.formError = '';
    this.book.emit({
      slotId: slot.id,
      name,
      email,
      phone: this.form.phone.trim(),
      notes: this.form.notes.trim(),
      address: this.form.address.trim(),
      eventDescription: this.form.eventDescription.trim(),
      guestCount: this.form.guestCount.trim()
    });
  }

  trackByDate(_: number, date: string) {
    return date;
  }

  trackByCalendarDay(_: number, day: { date: string | null }) {
    return day.date || `empty-${_}`;
  }
}
