import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type Product = {
  id: string;
  sku: string;
  title: string;
  category: string;
  description?: string;
  details?: string;
  image: string;
  mediaType: 'image' | 'video';
  price: number;
  checkoutEnabled?: boolean;
};

export type PrintSizeOption = {
  size: '4x6' | '5x7' | '6x8' | '8x10' | '8x11';
  label: string;
  unitPrice: number;
  priceBreaks: Array<{ minQty: number; unitPrice: number }>;
};

export type ProductOrderPayload = {
  product: Product;
  printSize: PrintSizeOption['size'];
  printUnitPrice: number;
  quantity: number;
  includeDigitalCopy: boolean;
};

export const PRINT_SIZE_OPTIONS: PrintSizeOption[] = [
  { size: '4x6', label: '4 x 6', unitPrice: 6, priceBreaks: [{ minQty: 1, unitPrice: 6 }, { minQty: 10, unitPrice: 5 }, { minQty: 25, unitPrice: 4.5 }, { minQty: 50, unitPrice: 4 }] },
  { size: '5x7', label: '5 x 7', unitPrice: 9, priceBreaks: [{ minQty: 1, unitPrice: 9 }, { minQty: 10, unitPrice: 8 }, { minQty: 25, unitPrice: 7 }, { minQty: 50, unitPrice: 6.5 }] },
  { size: '6x8', label: '6 x 8', unitPrice: 12, priceBreaks: [{ minQty: 1, unitPrice: 12 }, { minQty: 10, unitPrice: 11 }, { minQty: 25, unitPrice: 10 }, { minQty: 50, unitPrice: 9 }] },
  { size: '8x10', label: '8 x 10', unitPrice: 16, priceBreaks: [{ minQty: 1, unitPrice: 16 }, { minQty: 10, unitPrice: 15 }, { minQty: 25, unitPrice: 13.5 }, { minQty: 50, unitPrice: 12 }] },
  { size: '8x11', label: '8 x 11', unitPrice: 18, priceBreaks: [{ minQty: 1, unitPrice: 18 }, { minQty: 10, unitPrice: 16.5 }, { minQty: 25, unitPrice: 15 }, { minQty: 50, unitPrice: 13.5 }] }
];

export type ProductEditPayload = {
  id: string;
  title: string;
  category: string;
  description: string;
  details: string;
  price: number;
};

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './products.component.html',
  styleUrl: './products.component.css'
})
export class ProductsComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() products: Product[] = [];
  @Input() categoryOptions: string[] = [];
  @Input() loading = false;
  @Input() canManage = false;
  @Output() buy = new EventEmitter<Product>();
  @Output() buyPrint = new EventEmitter<ProductOrderPayload>();
  @Output() saveProduct = new EventEmitter<ProductEditPayload>();
  @Output() publishProduct = new EventEmitter<Product>();
  @Output() deleteProduct = new EventEmitter<Product>();
  @Output() mediaPreview = new EventEmitter<Product>();
  readonly printSizeOptions = PRINT_SIZE_OPTIONS;
  private readonly selectedPrintSizeByProduct: Record<string, PrintSizeOption['size']> = {};
  private readonly selectedPrintQuantityByProduct: Record<string, number> = {};

  // The catalogue grows a batch at a time as the reader reaches the end, rather
  // than all ~150 cards at once: every card carries a full-size image or a
  // video, so rendering the lot up front is a lot of DOM and a lot of requests.
  // Cards already opt into `loading="lazy"` and `preload="metadata"`, so what
  // has scrolled past costs little once it is there.
  @Input() pageSize = 12;
  shownCount = 12;
  private productsSignature = '';
  private shownSource: Product[] | null = null;
  private shownKey = '';
  private shownCache: Product[] = [];
  private observer?: IntersectionObserver;
  @ViewChild('sentinel') sentinel?: ElementRef<HTMLElement>;

  private readonly changeDetector: ChangeDetectorRef;
  private readonly zone: NgZone;
  constructor(changeDetector: ChangeDetectorRef, zone: NgZone) {
    this.changeDetector = changeDetector;
    this.zone = zone;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['products']) return;
    // Collapse back to the first batch when the listing itself changes
    // (category filter, admin edit or delete) rather than leaving the reader
    // scrolled deep into a list that now holds different items.
    const signature = `${this.products.length}:${this.products[0]?.id || ''}:${this.products[this.products.length - 1]?.id || ''}`;
    if (signature !== this.productsSignature) {
      this.productsSignature = signature;
      this.shownCount = this.pageSize;
      this.editingProductId = '';
    }
  }

  // The sentinel sits after the grid. Observing it rather than listening to
  // scroll means no scroll handler, no throttling, and it fires correctly when
  // a short first batch leaves the end of the list already on screen.
  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined' || !this.sentinel) return;
    // Outside Angular so an observer that fires during scrolling does not run
    // change detection on every tick; loadMore() re-enters deliberately.
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.zone.run(() => this.loadMore());
      }, { rootMargin: '600px 0px' });   // start fetching before it is in view
      this.observer.observe(this.sentinel!.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  get shownProducts(): Product[] {
    const key = `${this.shownCount}`;
    if (this.shownSource === this.products && this.shownKey === key) return this.shownCache;
    this.shownSource = this.products;
    this.shownKey = key;
    this.shownCache = this.products.slice(0, this.shownCount);
    return this.shownCache;
  }

  get hasMore(): boolean {
    return this.shownCount < this.products.length;
  }

  get shownEnd(): number {
    return Math.min(this.shownCount, this.products.length);
  }

  // Also bound to a real button. The observer covers ordinary scrolling, but a
  // button is what keyboard users and anything without IntersectionObserver
  // have, and it keeps the end of the list reachable without a pointer.
  loadMore(): void {
    if (!this.hasMore) return;
    this.shownCount += this.pageSize;
    this.changeDetector.markForCheck();
  }

  editingProductId = '';
  editModel: ProductEditPayload = {
    id: '',
    title: '',
    category: '',
    description: '',
    details: '',
    price: 20
  };

  onBuy(product: Product) {
    this.buy.emit(product);
  }

  onBuyPrint(product: Product) {
    if (product.mediaType === 'video') return;
    const selection = this.getPrintSelection(product);
    this.buyPrint.emit({
      product,
      printSize: selection.size,
      printUnitPrice: selection.unitPrice,
      quantity: selection.quantity,
      includeDigitalCopy: true
    });
  }

  onBuyPrintOnly(product: Product) {
    if (product.mediaType === 'video') return;
    const selection = this.getPrintSelection(product);
    this.buyPrint.emit({
      product,
      printSize: selection.size,
      printUnitPrice: selection.unitPrice,
      quantity: selection.quantity,
      includeDigitalCopy: false
    });
  }

  getSelectedPrintSize(productId: string): PrintSizeOption['size'] {
    return this.selectedPrintSizeByProduct[productId] || '8x10';
  }

  setSelectedPrintSize(productId: string, value: string) {
    const matched = this.printSizeOptions.find(option => option.size === value)?.size;
    this.selectedPrintSizeByProduct[productId] = matched || '8x10';
  }

  getSelectedPrintQuantity(productId: string): number {
    return this.selectedPrintQuantityByProduct[productId] || 1;
  }

  setSelectedPrintQuantity(productId: string, value: number) {
    this.selectedPrintQuantityByProduct[productId] = Math.max(1, Math.round(value || 1));
  }

  getPrintUnitPrice(productId: string): number {
    const size = this.getSelectedPrintSize(productId);
    const quantity = this.getSelectedPrintQuantity(productId);
    const option = this.printSizeOptions.find(entry => entry.size === size) || this.printSizeOptions[3];
    const tier = [...option.priceBreaks]
      .sort((left, right) => right.minQty - left.minQty)
      .find(entry => quantity >= entry.minQty);
    return tier?.unitPrice || option.unitPrice;
  }

  getPrintSubtotal(productId: string): number {
    return this.getPrintUnitPrice(productId) * this.getSelectedPrintQuantity(productId);
  }

  getPrintTierHint(productId: string): string {
    const size = this.getSelectedPrintSize(productId);
    const quantity = this.getSelectedPrintQuantity(productId);
    const option = this.printSizeOptions.find(entry => entry.size === size) || this.printSizeOptions[3];
    const nextTier = [...option.priceBreaks]
      .sort((left, right) => left.minQty - right.minQty)
      .find(entry => entry.minQty > quantity);
    if (!nextTier) {
      return 'Best tier unlocked at current quantity.';
    }
    return `Add ${nextTier.minQty - quantity} more to unlock $${nextTier.unitPrice.toFixed(2)} each.`;
  }

  private getPrintSelection(product: Product) {
    const size = this.getSelectedPrintSize(product.id);
    const quantity = this.getSelectedPrintQuantity(product.id);
    const option = this.printSizeOptions.find(entry => entry.size === size) || this.printSizeOptions[3];
    const tier = [...option.priceBreaks]
      .sort((left, right) => right.minQty - left.minQty)
      .find(entry => quantity >= entry.minQty);
    return {
      size: option.size,
      unitPrice: tier?.unitPrice || option.unitPrice,
      quantity
    };
  }

  onPublish(product: Product) {
    if (product.checkoutEnabled || !this.canManage) return;
    this.publishProduct.emit(product);
  }

  onMediaPreview(product: Product) {
    if (this.editingProductId) return;
    this.mediaPreview.emit(product);
  }

  onDelete(product: Product) {
    if (!this.canManage) return;
    this.deleteProduct.emit(product);
  }

  trackByProduct(_: number, product: Product) {
    return product.id;
  }

  private resolveEditableCategory(rawCategory: string): string {
    const trimmed = String(rawCategory || '').trim();
    if (!this.categoryOptions.length) return trimmed || 'Digital image';
    const exact = this.categoryOptions.find(option => option.toLowerCase() === trimmed.toLowerCase());
    if (exact) return exact;
    const prefix = this.categoryOptions.find(option => trimmed.toLowerCase().startsWith(option.toLowerCase()));
    return prefix || this.categoryOptions[0];
  }

  startEdit(product: Product) {
    if (!this.canManage) return;
    this.editingProductId = product.id;
    this.editModel = {
      id: product.id,
      title: product.title,
      category: this.resolveEditableCategory(product.category),
      description: product.description || '',
      details: product.details || '',
      price: product.price || 20
    };
  }

  cancelEdit() {
    this.editingProductId = '';
  }

  saveEdit() {
    if (!this.canManage) return;
    if (!this.editModel.id || !this.editModel.title.trim()) return;
    const firstCategory = this.categoryOptions[0] || 'Digital image';
    this.saveProduct.emit({
      ...this.editModel,
      title: this.editModel.title.trim(),
      category: this.editModel.category.trim() || firstCategory,
      description: this.editModel.description.trim(),
      details: this.editModel.details.trim(),
      price: Math.max(1, Math.round(this.editModel.price || 20))
    });
    this.editingProductId = '';
  }
}
