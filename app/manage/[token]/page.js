import { loadDB, defaultDB } from '@/lib/storage'
import { notFound } from 'next/navigation'
import AdminClient from './AdminClient'

export const dynamic = 'force-dynamic'

export default async function ManagePage({ params }) {
  const { token } = await params
  const db = await loadDB()
  const def = defaultDB()
  if (db.settings.adminToken !== token && def.settings.adminToken !== token) notFound()
  return <AdminClient token={token} />
}
