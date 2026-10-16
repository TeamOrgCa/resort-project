import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import { requestHasEmojiText } from './lib/server/text-input-validation'
import { EMOJI_INPUT_MESSAGE } from './lib/validation/emoji'

export async function proxy(request: NextRequest) {
  const response = await updateSession(request)
  if (request.nextUrl.pathname.startsWith('/api/') && response.headers.get('x-middleware-next') === '1' && await requestHasEmojiText(request)) {
    const rejected = NextResponse.json({ success: false, code: 'EMOJI_NOT_ALLOWED', message: EMOJI_INPUT_MESSAGE }, { status: 400 })
    response.cookies.getAll().forEach(cookie => rejected.cookies.set(cookie))
    return rejected
  }
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
