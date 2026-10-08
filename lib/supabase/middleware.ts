import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { apiPermission, getDefaultRouteForRole, hasPermission, routePermission } from '@/lib/auth/role-access'
import { STAFF_SESSION_COOKIE, type StaffRole } from '@/lib/auth/staff-auth'
import { getStaffSessionTokenFromCookieStore } from '@/lib/auth/staff-session'
import { getAuthSessionId } from '@/lib/auth/auth-session'

const STAFF_LOGIN_PATH = '/staff/login'

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach(({ name, value, path, domain, maxAge, httpOnly, secure, sameSite }) => 
    target.cookies.set(name, value, { path, domain, maxAge, httpOnly, secure, sameSite })
  )
}

function redirectToStaffLogin(request: NextRequest, supabaseResponse: NextResponse, replaced = false) {
  const url = request.nextUrl.clone()
  url.pathname = STAFF_LOGIN_PATH
  url.searchParams.delete('redirect')
  if (replaced) url.searchParams.set('reason', 'session-replaced')

  const redirectResponse = NextResponse.redirect(url)
  copyCookies(supabaseResponse, redirectResponse)
  redirectResponse.cookies.delete(STAFF_SESSION_COOKIE)

  return redirectResponse
}

function redirectToGuestLogin(request: NextRequest, supabaseResponse: NextResponse, replaced = false) {
  const url = request.nextUrl.clone()
  url.pathname = '/auth/login'
  url.searchParams.set('redirect', request.nextUrl.pathname)
  if (replaced) url.searchParams.set('reason', 'session-replaced')
  const response = NextResponse.redirect(url)
  copyCookies(supabaseResponse, response)
  return response
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isGuestPage = path.startsWith('/booking/form') || path.startsWith('/booking/payment') || path.startsWith('/manage')
  const isGuestApi = (path.startsWith('/api/reservations/') && !path.startsWith('/api/reservations/availability')) ||
    path.startsWith('/api/ocular-visits') || path === '/api/reviews/create' || path === '/api/auth/me'
  if (isGuestPage || isGuestApi) {
    if (!user) return isGuestApi ? NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) : redirectToGuestLogin(request, supabaseResponse)
    const { data: guest, error: guestError } = await supabase.from('guests')
      .select('active_session_id').eq('id', user.id).maybeSingle<{ active_session_id: string | null }>()
    if (guestError) return new NextResponse('Unable to verify session.', { status: 503 })
    const { data: { session } } = await supabase.auth.getSession()
    const sessionId = getAuthSessionId(session?.access_token)
    if (!guest || !sessionId || guest.active_session_id !== sessionId) {
      await supabase.auth.signOut({ scope: 'local' })
      return isGuestApi ? NextResponse.json({ message: 'Your session ended because this account signed in on another device.' }, { status: 401 })
        : redirectToGuestLogin(request, supabaseResponse, Boolean(guest))
    }
  }

  // Protect admin routes with role-based access control
  const isAdminPage = request.nextUrl.pathname.startsWith('/admin/') || request.nextUrl.pathname === '/admin'
  const isAdminApi = request.nextUrl.pathname.startsWith('/api/admin/') && !request.nextUrl.pathname.startsWith('/api/admin/auth/')
  const apiRequiredPermission = isAdminApi
    ? apiPermission(request.nextUrl.pathname, request.method) : null
  if (isAdminPage || isAdminApi) {
    if (request.nextUrl.pathname === '/admin/login') {
      return NextResponse.redirect(new URL(STAFF_LOGIN_PATH, request.url))
    }

    if (request.nextUrl.pathname.startsWith('/staff/login')) {
      return supabaseResponse
    }
    if (!user) {
      if (isAdminApi) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 })
      const url = request.nextUrl.clone()
      url.pathname = STAFF_LOGIN_PATH
      if (request.nextUrl.pathname !== '/admin/login') {
        url.searchParams.set('redirect', request.nextUrl.pathname)
      }
      return NextResponse.redirect(url)
    }

    // Fetch user role from staff_users
    try {
      const { data: staffUser } = await supabase
        .from('staff_users')
        .select('role, is_active, active_session_id')
        .eq('id', user.id)
        .maybeSingle<{ role: StaffRole; is_active: boolean; active_session_id: string | null }>()

      if (!staffUser) {
        if (isAdminApi) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 })
        await supabase.auth.signOut({ scope: 'local' })
        return redirectToStaffLogin(request, supabaseResponse)
      }

      const sessionToken = getStaffSessionTokenFromCookieStore(request.cookies)

      if (!staffUser.is_active || !sessionToken || staffUser.active_session_id !== sessionToken) {
        if (isAdminApi) return NextResponse.json({ message: 'Your session ended because this account signed in on another device.' }, { status: 401 })
        await supabase.auth.signOut({ scope: 'local' })
        return redirectToStaffLogin(request, supabaseResponse, true)
      }

      const { data: permissionRow, error: permissionError } = staffUser.role === 'admin'
        ? { data: null, error: null }
        : await supabase.from('role_permissions').select('permissions').eq('role', staffUser.role).maybeSingle()
      const granted = permissionError || !Array.isArray(permissionRow?.permissions) ? [] : permissionRow.permissions as string[]
      if (apiRequiredPermission && !hasPermission(staffUser.role, granted, apiRequiredPermission)) {
        return NextResponse.json({ message: 'Forbidden.' }, { status: 403 })
      }
      const pagePermission = isAdminPage ? routePermission(request.nextUrl.pathname) : null
      if (isAdminPage && (!pagePermission || !hasPermission(staffUser.role, granted, pagePermission))) {
        // Redirect to role's default route instead of admin/login for unauthorized access
        const url = request.nextUrl.clone()
        url.pathname = getDefaultRouteForRole(staffUser.role, granted)
        return NextResponse.redirect(url)
      }
    } catch {
      if (isAdminApi) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 })
      // If there's an error fetching role, redirect to login
      const url = request.nextUrl.clone()
      url.pathname = '/admin/login'
      return NextResponse.redirect(url)
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely.

  return supabaseResponse
}
