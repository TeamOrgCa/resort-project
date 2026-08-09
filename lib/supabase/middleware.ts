import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessRoute, getDefaultRouteForRole } from '@/lib/auth/role-access'
import { STAFF_SESSION_COOKIE, type StaffRole } from '@/lib/auth/staff-auth'
import { getStaffSessionTokenFromCookieStore } from '@/lib/auth/staff-session'

const STAFF_LOGIN_PATH = '/staff/login'

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie.name, cookie.value, cookie.options))
}

function redirectToStaffLogin(request: NextRequest, supabaseResponse: NextResponse) {
  const url = request.nextUrl.clone()
  url.pathname = STAFF_LOGIN_PATH
  url.searchParams.delete('redirect')

  const redirectResponse = NextResponse.redirect(url)
  copyCookies(supabaseResponse, redirectResponse)
  redirectResponse.cookies.delete(STAFF_SESSION_COOKIE)

  return redirectResponse
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
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
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

  // Protect booking-related routes
  if (!user && (request.nextUrl.pathname.startsWith('/booking/form') || 
                request.nextUrl.pathname.startsWith('/booking/payment') ||
                request.nextUrl.pathname.startsWith('/manage'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  // Protect admin routes with role-based access control
  if (request.nextUrl.pathname.startsWith('/admin/') || request.nextUrl.pathname === '/admin') {
    if (request.nextUrl.pathname === '/admin/login') {
      return NextResponse.redirect(new URL(STAFF_LOGIN_PATH, request.url))
    }

    if (request.nextUrl.pathname.startsWith('/staff/login')) {
      return supabaseResponse
    }
    if (!user) {
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
        await supabase.auth.signOut()
        return redirectToStaffLogin(request, supabaseResponse)
      }

      const sessionToken = getStaffSessionTokenFromCookieStore(request.cookies)

      if (!staffUser.is_active || !sessionToken || staffUser.active_session_id !== sessionToken) {
        await supabase.auth.signOut()
        return redirectToStaffLogin(request, supabaseResponse)
      }

      // Check if user can access this route
      if (!canAccessRoute(staffUser.role, request.nextUrl.pathname)) {
        // Redirect to role's default route instead of admin/login for unauthorized access
        const url = request.nextUrl.clone()
        url.pathname = getDefaultRouteForRole(staffUser.role)
        return NextResponse.redirect(url)
      }
    } catch (error) {
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
