import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/app-context';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'SMART PRICE — Intelligent Food Price Monitoring',
  description: 'Мониторинг цен на продукты в Казахстане. GOVTECH Hackathon 2026 · SMART PRICE',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="h-full">
      <body className="h-full font-sans bg-[#F6F7F9] text-slate-900 antialiased">
        <AppProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </AppProvider>
      </body>
    </html>
  );
}

