import { PRODUCT_NAME } from "@repo/config/product";
import { ProductMark as LibraryProductMark } from "@repo/ui";

/** The product's mark and name (§9 Navigation): the library mark, named from PRODUCT_NAME. */
export function ProductMark({ className }: { readonly className?: string | undefined }) {
  return <LibraryProductMark name={PRODUCT_NAME} className={className} />;
}
