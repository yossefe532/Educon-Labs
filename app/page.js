import { loadDB } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const db = await loadDB()
  const { placeName, placeNameEn, openTime, closeTime, storageMode } = db.settings
  const halls = db.halls || []

  return (
    <div className="container">
      {storageMode !== 'redis' && (
        <div className="card" style={{ background: '#fef2f2', border: '1px solid #fca5a5', marginBottom: 12 }}>
          <p style={{ margin: 0, color: '#991b1b', fontSize: 13 }}>
            <strong>تنبيه:</strong> البيانات غير محفوظة بشكل دائم. يجب إعداد Vercel KV.
          </p>
        </div>
      )}
      <div className="home-hero">
        <h1>{placeName || 'اكاديمية ايديكون للتدريب'}</h1>
        <div className="en">{placeNameEn || 'EDUCON ACADEMY'}</div>
        <p>{halls.length > 0 ? `${halls.length} قاعات جاهزة` : 'نظام إدارة حجز القاعات'}</p>
      </div>

      <div className="home-cards">
        <a className="home-card" href="/display">
          <div className="icon">◉</div>
          <h3>شاشة العرض</h3>
          <div className="small muted">للشاشة الثابتة في الواجهة (F11)</div>
        </a>
        <a className="home-card" href="/book">
          <div className="icon">✦</div>
          <h3>الحجز الخارجي</h3>
          <div className="small muted">أرسل هذا الرابط للمدرسين</div>
        </a>
      </div>

      {halls.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>الأسعار</h3>
          <table className="price-table">
            <thead><tr><th>القاعة</th><th>سعر الساعة</th><th>ساعات العمل</th></tr></thead>
            <tbody>
              {halls.map(h => (
                <tr key={h.id}>
                  <td><span className="dot" style={{ background: h.color }} />{h.name}</td>
                  <td>{h.pricePerHour} جنيه</td>
                  <td className="muted">{Math.floor(openTime / 60)}:{String(openTime % 60).padStart(2, '0')} - {Math.floor(closeTime / 60)}:{String(closeTime % 60).padStart(2, '0')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
