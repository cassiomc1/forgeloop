export interface Product {
  id: string;
  name: string;
  category: 'audio' | 'desk' | 'travel';
  price: number;
}

export interface CatalogFilter {
  category?: Product['category'];
  maxPrice?: number;
}

export function filterProducts(products: Product[], filter: CatalogFilter): Product[] {
  return products.filter((product) => {
    if (filter.category && product.category !== filter.category) return false;
    if (filter.maxPrice !== undefined && product.price > filter.maxPrice) return false;
    return true;
  });
}
