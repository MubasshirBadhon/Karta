export default function DemoPage() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          AI Demo
        </h1>
        <p className="text-gray-500 mb-8">
          Test Karta&apos;s AI commerce engine with real product data.
        </p>

        <div className="rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Coming in Phase 2
          </h2>
          <p className="text-sm text-gray-500">
            The AI demo interface will allow you to chat with the AI assistant
            using real product data from a connected WooCommerce store.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-gray-500">
            <li>Product search and recommendations</li>
            <li>Variant and stock lookup</li>
            <li>Bangla, Banglish, and English support</li>
            <li>Cart and order management</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
