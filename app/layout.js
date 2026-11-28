import './globals.css';

export const metadata = {
  title: 'Alu Signal Z Pro',
  description: 'SMC x ICT x Alchemist AI Trading Signal',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
