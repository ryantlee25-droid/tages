import { Nav } from '@/components/marketing/nav'
import { Footer } from '@/components/marketing/footer'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
