import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type CartItem = {
  cartItemId: string;
  productId: string;
  sku: string;
  title: string;
  price: number;
  quantity: number;
  image: string;
  mediaType: 'image' | 'video';
  orderType: 'digital' | 'print';
  printSize?: '4x6' | '5x7' | '6x8' | '8x10' | '8x11';
  checkoutEnabled: boolean;
  description?: string;
};

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.css'
})
export class CartComponent {
  @Input() cartItems: CartItem[] = [];
  @Input() activeCartCount = 0;
  @Input() cartTotal = 0;
  @Input() cartCheckingOut = false;
  @Input() hasDigitalItems = false;
  @Input() digitalDeliveryEmail = '';
  @Input() deliveryUpdatesOptIn = false;
  @Input() cartFormError = '';

  @Output() removeItem = new EventEmitter<string>();
  @Output() updateQuantity = new EventEmitter<{ cartItemId: string; quantity: number }>();
  @Output() deliveryEmailChange = new EventEmitter<string>();
  @Output() deliveryUpdatesOptInChange = new EventEmitter<boolean>();
  @Output() checkout = new EventEmitter<void>();

  onRemove(cartItemId: string) {
    this.removeItem.emit(cartItemId);
  }

  onUpdateQuantity(cartItemId: string, quantity: number) {
    this.updateQuantity.emit({ cartItemId, quantity });
  }

  onDeliveryEmailChange(value: string) {
    this.deliveryEmailChange.emit(value);
  }

  onDeliveryUpdatesOptInChange(value: boolean) {
    this.deliveryUpdatesOptInChange.emit(!!value);
  }

  onCheckout() {
    this.checkout.emit();
  }

  trackByCartItem(_: number, item: CartItem) {
    return item.cartItemId;
  }
}
