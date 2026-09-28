import { prisma } from "@/lib/db/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: { variants: true },
  });

  if (!product) {
    notFound();
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/dashboard/products"
          className="text-karta-primary hover:text-karta-secondary text-sm"
        >
          Back to Products
        </Link>

        <div className="mt-6 flex gap-8">
          {/* Product Image */}
          <div className="w-64 h-64 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
            {product.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.image}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-gray-400">No image</span>
            )}
          </div>

          {/* Product Info */}
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>
            <p className="text-gray-500 mt-2">{product.description}</p>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-500">SKU</div>
                <div className="font-medium">{product.sku || "-"}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Price</div>
                <div className="font-medium">৳{Number(product.price).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Compare At</div>
                <div className="font-medium">
                  {product.compareAtPrice
                    ? `৳${Number(product.compareAtPrice).toFixed(2)}`
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Stock</div>
                <div className="font-medium">{product.stock}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Status</div>
                <div>
                  <span
                    className={`inline-block px-2 py-1 text-xs rounded-full ${
                      product.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {product.status}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500">External ID</div>
                <div className="font-medium">{product.externalId || "-"}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Variants */}
        {product.variants.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Variants</h2>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">SKU</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Attributes</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Price</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {product.variants.map((variant) => (
                    <tr key={variant.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {variant.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {variant.sku || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {Object.entries(variant.attributes as Record<string, string>)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(", ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        ৳{Number(variant.price).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {variant.stock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
