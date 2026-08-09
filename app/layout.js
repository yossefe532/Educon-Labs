import './globals.css'

export const metadata = {
  title: 'EDUCON ACADEMY — نظام حجز القاعات',
  description: 'اكاديمية ايديكون للتدريب — نظام إدارة حجز قاعات المدرسين',
  icons: { icon: '/favicon.svg' }
}

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
