import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        {/* Logo / Brand */}
        <h1 className="text-6xl font-bold tracking-tight text-karta-primary mb-2">
          Karta
        </h1>
        <p className="text-xl text-gray-600 mb-1">
          Turn every conversation into a sale.
        </p>
        <p className="text-base text-gray-500 mb-10">
          AI commerce for WooCommerce merchants.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg bg-karta-primary px-8 py-3 text-base font-semibold text-white shadow-sm hover:bg-karta-secondary transition-colors"
          >
            Connect Store
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-8 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            Try AI Demo
          </Link>
        </div>

        {/* Feature Highlights */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-1">WooCommerce Sync</h3>
            <p className="text-sm text-gray-500">
              Connect your store and sync products automatically.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-1">AI Sales Assistant</h3>
            <p className="text-sm text-gray-500">
              Answer customer questions with real product data.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-1">WhatsApp + Web</h3>
            <p className="text-sm text-gray-500">
              One AI engine for all your sales channels.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
