"use client";

import { useState, useEffect } from "react";

interface Connection {
  id: string;
  connectionId: string;
  siteUrl: string;
  siteName: string | null;
  status: string;
  lastSyncAt: string | null;
  createdAt: string;
}

interface CreateResponse {
  success: boolean;
  connectionId?: string;
  connectionSecret?: string;
  siteUrl?: string;
  siteName?: string;
  apiUrl?: string;
  error?: string;
}

export default function WooCommerceIntegrationPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [siteName, setSiteName] = useState("");
  const [newConnection, setNewConnection] = useState<CreateResponse | null>(null);
  const [error, setError] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<string>("");

  useEffect(() => {
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
    try {
      const response = await fetch("/api/integrations/woocommerce/connections");
      const data = await response.json();
      if (data.success) {
        setConnections(data.connections);
      }
    } catch {
      // Ignore fetch errors
    } finally {
      setLoading(false);
    }
  };

  const createConnection = async () => {
    if (!siteUrl.trim()) {
      setError("Please enter your WordPress site URL");
      return;
    }

    setCreating(true);
    setError("");
    setNewConnection(null);

    try {
      const response = await fetch("/api/integrations/woocommerce/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl, siteName: siteName || undefined }),
      });

      const data: CreateResponse = await response.json();

      if (data.success) {
        setNewConnection(data);
        setSiteUrl("");
        setSiteName("");
        fetchConnections();
      } else {
        setError(data.error || "Failed to create connection");
      }
    } catch {
      setError("Failed to create connection");
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(""), 2000);
  };

  const maskSecret = (secret: string) => {
    return secret.substring(0, 8) + "••••••••" + secret.substring(secret.length - 8);
  };

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          WooCommerce Integration
        </h1>
        <p className="text-gray-500 mb-8">
          Connect your WooCommerce store to Karta AI commerce platform.
        </p>

        {/* Create Connection */}
        <div className="rounded-lg border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Connect New Store
          </h2>

          {newConnection ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-4">
              <h3 className="font-semibold text-green-800 mb-4">
                Connection Created Successfully!
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">
                    Karta API URL
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm">
                      {newConnection.apiUrl}
                    </code>
                    <button
                      onClick={() => copyToClipboard(newConnection.apiUrl || "", "apiUrl")}
                      className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                    >
                      {copied === "apiUrl" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">
                    Connection ID
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm">
                      {newConnection.connectionId}
                    </code>
                    <button
                      onClick={() => copyToClipboard(newConnection.connectionId || "", "connectionId")}
                      className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                    >
                      {copied === "connectionId" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">
                    Connection Secret
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm">
                      {showSecret
                        ? newConnection.connectionSecret
                        : maskSecret(newConnection.connectionSecret || "")}
                    </code>
                    <button
                      onClick={() => setShowSecret(!showSecret)}
                      className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                    >
                      {showSecret ? "Hide" : "Show"}
                    </button>
                    <button
                      onClick={() => copyToClipboard(newConnection.connectionSecret || "", "secret")}
                      className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                    >
                      {copied === "secret" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-red-600 mt-2">
                    Copy this secret now. For security, it will not be shown again.
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-green-200">
                <h4 className="font-medium text-gray-900 mb-2">
                  Next Steps:
                </h4>
                <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                  <li>Copy the API URL, Connection ID, and Secret above</li>
                  <li>Open your WordPress admin → Settings → Karta</li>
                  <li>Paste the values and click Connect</li>
                  <li>Click Sync Products in WordPress</li>
                </ol>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  WordPress Site URL
                </label>
                <input
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://your-store.com"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-karta-primary"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Store Name (optional)
                </label>
                <input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="My WooCommerce Store"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-karta-primary"
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 rounded-lg px-4 py-2 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={createConnection}
                disabled={creating}
                className="rounded-lg bg-karta-primary px-6 py-2 text-white text-sm font-medium hover:bg-karta-secondary disabled:opacity-50"
              >
                {creating ? "Creating..." : "Connect WooCommerce"}
              </button>
            </div>
          )}
        </div>

        {/* Existing Connections */}
        <div className="rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Connected Stores
          </h2>

          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : connections.length === 0 ? (
            <p className="text-gray-500">
              No stores connected yet. Use the form above to connect your first WooCommerce store.
            </p>
          ) : (
            <div className="space-y-4">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="border border-gray-200 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {conn.siteName || conn.siteUrl}
                      </h3>
                      <p className="text-sm text-gray-500">{conn.siteUrl}</p>
                    </div>
                    <span
                      className={`inline-block px-2 py-1 text-xs rounded-full ${
                        conn.status === "active"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {conn.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    Connection ID: {conn.connectionId}
                  </div>
                  {conn.lastSyncAt && (
                    <div className="mt-1 text-xs text-gray-400">
                      Last sync: {new Date(conn.lastSyncAt).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
