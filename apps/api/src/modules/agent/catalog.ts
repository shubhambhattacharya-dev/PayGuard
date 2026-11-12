export interface CatalogItem {
  readonly sku: string;
  readonly name: string;
  readonly description: string;
  readonly unitPriceMinor: number;
}

export interface CatalogStore {
  search(query: string, limit?: number): readonly CatalogItem[];
  getBySku(sku: string): CatalogItem | null;
}

/**
 * Owner-controlled catalog data (OWASP LLM04): the model can read it via
 * search_catalog but can never write it. Prices are integer minor units.
 */
export const DEFAULT_CATALOG: readonly CatalogItem[] = [
  { sku: 'CED-PPR-01', name: 'Office Paper Reams', description: 'Cedar Supply copy paper, 500 sheets per ream', unitPriceMinor: 1600 },
  { sku: 'AC-PRO-001', name: 'Aster Cloud Professional Plan', description: 'Aster Cloud monthly professional subscription', unitPriceMinor: 84250 },
  { sku: 'LM-CHR-02', name: 'Ergonomic Office Chair', description: 'Lumen Office ergonomic mesh chair', unitPriceMinor: 32500 },
  { sku: 'BB-FRT-10', name: 'Freight Shipment Domestic', description: 'Bluebird Logistics domestic freight flat rate', unitPriceMinor: 11700 },
  { sku: 'LM-DSK-04', name: 'Standing Desk', description: 'Lumen Office electric standing desk', unitPriceMinor: 44900 },
  { sku: 'CD-INK-77', name: 'Toner Cartridge', description: 'Cedar Supply high-yield toner cartridge', unitPriceMinor: 8900 },
  { sku: 'BB-PAK-25', name: 'Packaging Kit', description: 'Bluebird Logistics bulk packaging kit', unitPriceMinor: 6400 },
  { sku: 'AC-STO-100', name: 'Aster Cloud Storage Add-on', description: 'Aster Cloud 1TB storage add-on', unitPriceMinor: 9900 },
];

export function createCatalog(items: readonly CatalogItem[] = DEFAULT_CATALOG): CatalogStore {
  const bySku = new Map<string, CatalogItem>();
  for (const item of items) {
    bySku.set(item.sku, item);
  }

  return {
    search(query, limit = 5): readonly CatalogItem[] {
      const needle = query.trim().toLowerCase();
      const matches: CatalogItem[] = [];
      for (const item of items) {
        const haystack = `${item.sku} ${item.name} ${item.description}`.toLowerCase();
        if (haystack.includes(needle)) {
          matches.push(item);
          if (matches.length >= limit) {
            break;
          }
        }
      }
      return matches;
    },
    getBySku(sku: string): CatalogItem | null {
      return bySku.get(sku.trim()) ?? null;
    },
  };
}
