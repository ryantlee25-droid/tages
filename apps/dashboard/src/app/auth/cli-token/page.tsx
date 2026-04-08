import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function CliTokenPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/auth/login?next=/auth/cli-token')
  }

  const command = `mkdir -p ~/.config/tages && cat > ~/.config/tages/auth.json << 'EOF'\n${JSON.stringify({ accessToken: session.access_token, refreshToken: session.refresh_token, userId: session.user.id }, null, 2)}\nEOF`

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-6">
        <h1 className="text-2xl font-bold">CLI Authentication</h1>
        <p className="text-gray-400">
          Copy and paste this command in your terminal to connect the Tages CLI:
        </p>
        <pre className="bg-[#1A1A1B] p-4 rounded-lg overflow-x-auto text-sm font-mono text-green-400 select-all">
          {command}
        </pre>
        <p className="text-gray-500 text-sm">
          This saves your session tokens to ~/.config/tages/auth.json.
          Tokens refresh automatically. Do not share this output.
        </p>
      </div>
    </div>
  )
}
