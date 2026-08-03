import { loadDB } from '@/lib/storage'
import { notFound } from 'next/navigation'
import BookingClient from './BookingClient'

export const dynamic = 'force-dynamic'

export default async function BookPage({ params }) {
  const { token } = await params
  const db = await loadDB()
  if (db.settings.bookingToken !== token) notFound()
  return <BookingClient token={token} />
}
