import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/project(.*)']);

const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

const withClerk = clerkMiddleware(async (auth, req) => {
  if (!isProtectedRoute(req)) return;
  const { userId } = await auth();
  if (!userId) {
    const target = new URL('/', req.url);
    target.searchParams.set('sign-in', '1');
    target.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(target);
  }
});

export default function middleware(req: NextRequest, event: Parameters<typeof withClerk>[1]) {
  if (!clerkConfigured) return NextResponse.next();
  return withClerk(req, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
