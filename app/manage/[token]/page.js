import { loadDB } from '@/lib/storage'
import { notFound } from 'next/navigation'
import AdminClient from './AdminClient'

export const dynamic = 'force-dynamic'

export default async function ManagePage({ params }) {
  const { token } = await params
  const db = await loadDB()
  if (db.settings.adminToken !== token) notFound()
  return <AdminClient token={token} />
}
