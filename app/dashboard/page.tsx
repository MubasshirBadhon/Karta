import Link from "next/link";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Get stats for the dashboard
  const tenant = await prisma.tenant.findFirst({
    orderBy: { createdAt: "asc" },
  });

  const productCount = tenant
    ? await prisma.product.count({ where: { tenantId: tenant.id } })
    : 0;

  const connection = tenant
    ? await prisma.wooCommerceConnection.findFirst({
        where: { tenantId: tenant.id },
      })
    : null;

  const whatsAppConnection = tenant
    ? await prisma.whatsAppConnection.findFirst({
        where: { tenantId: tenant.id },
      })
    : null;

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Merchant Dashboard
        </h1>
        <p className="text-gray-500 mb-8">
          Manage your Karta AI commerce engine.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Store Connection */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Store Connection
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              WooCommerce store connected via WordPress plugin.
            </p>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-3 w-3 rounded-full ${
                  connection ? "bg-green-500" : "bg-gray-300"
                }`}
              ></span>
              <span className="text-sm text-gray-500">
                {connection ? "Connected" : "Not connected"}
              </span>
            </div>
            {connection && (
              <p className="text-xs text-gray-400 mt-2">
                {connection.siteUrl}
              </p>
            )}
          </div>

          {/* Product Catalog */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Product Catalog
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Products synced from your WooCommerce store.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-gray-900">
                {productCount}
              </span>
              <span className="text-sm text-gray-500">products</span>
            </div>
            <Link
              href="/dashboard/products"
              className="text-karta-primary hover:text-karta-secondary text-sm mt-2 inline-block"
            >
              View Products →
            </Link>
          </div>

          {/* Channels */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Channels
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Active sales channels for AI commerce.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-green-500"></span>
                <span className="text-sm text-gray-500">Website</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    whatsAppConnection ? "bg-green-500" : "bg-gray-300"
                  }`}
                ></span>
                <span className="text-sm text-gray-500">WhatsApp</span>
              </div>
            </div>
          </div>

          {/* AI Engine */}
          <div className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              AI Engine
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              AI provider status and configuration.
            </p>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-3 w-3 rounded-full ${
                  process.env.GROQ_API_KEY ? "bg-green-500" : "bg-gray-300"
                }`}
              ></span>
              <span className="text-sm text-gray-500">
                {process.env.GROQ_API_KEY ? "Groq configured" : "Not configured"}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Quick Actions
          </h2>
          <div className="flex gap-4">
            <Link
              href="/dashboard/products"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              View Products
            </Link>
            <Link
              href="/demo/chat"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Try AI Chat
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
