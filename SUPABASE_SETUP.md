# Supabase Authentication Setup Guide

## Overview
This guide will help you set up Supabase authentication for the MarVille Resort Complex website.

## Prerequisites
- Supabase account created
- Project created in Supabase
- Environment variables set in `.env` file

## Step 1: Database Setup

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Open the `supabase-schema.sql` file in this project
4. Copy and paste the SQL code into the SQL Editor
5. Click **Run** to execute the script

This will create:
- `profiles` table with all required fields
- Row Level Security (RLS) policies
- Triggers for automatic profile creation
- Indexes for performance

## Step 2: Configure Authentication

### Enable Email Authentication
1. Go to **Authentication** → **Providers**
2. Make sure **Email** provider is enabled
3. Configure email templates (optional):
   - Go to **Authentication** → **Email Templates**
   - Customize the confirmation and password reset emails

### Email Confirmation Settings
1. Go to **Authentication** → **Settings**
2. Under **Email Auth**:
   - ✅ Enable email confirmations (or disable for development)
   - Set **Confirm email** redirect URL to: `http://localhost:3000/auth/callback`

## Step 3: Environment Variables

Ensure your `.env` file contains:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your_anon_key
```

## Step 4: Test Authentication

1. Start your development server: `npm run dev`
2. Navigate to `/auth/register`
3. Create a test account
4. Check Supabase Dashboard → **Authentication** → **Users** to verify the user was created
5. Check **Table Editor** → **profiles** to verify profile data was saved

## Features Implemented

### Registration (`/auth/register`)
- First Name ✅
- Last Name ✅
- Middle Name (optional) ✅
- Email Address ✅
- Phone Number ✅
- Address ✅
- Password (min 6 characters) ✅

### Login (`/auth/login`)
- Email/Password authentication ✅
- Redirect to original page after login ✅

### User Menu Component
- Displays user avatar with initials ✅
- Shows full name and email ✅
- Quick access to:
  - My Bookings
  - Profile Settings
  - Sign Out

### Protected Routes
The following routes require authentication:
- `/booking/form` - Reservation form
- `/booking/payment` - Payment processing
- `/manage` - Booking management

If a user tries to access these routes without being logged in, they'll be redirected to the login page.

## Database Schema

### profiles table
| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | Yes | Foreign key to auth.users |
| first_name | text | Yes | User's first name |
| last_name | text | Yes | User's last name |
| middle_name | text | No | User's middle name (optional) |
| email | text | Yes | User's email address |
| phone_number | text | Yes | User's contact number |
| address | text | Yes | User's full address |
| created_at | timestamp | Yes | Account creation time |
| updated_at | timestamp | Yes | Last update time |

## Security Features

✅ Row Level Security (RLS) enabled
✅ Users can only read/update their own data
✅ Automatic profile creation on signup
✅ Secure password hashing (handled by Supabase)
✅ JWT-based authentication
✅ HTTP-only cookies for session management

## Troubleshooting

### Users not showing in profiles table
- Check if the trigger `on_auth_user_created` is enabled
- Manually check the `auth.users` table in SQL Editor
- Verify RLS policies are not blocking inserts

### Authentication not persisting
- Clear browser cookies and cache
- Check middleware.ts is properly configured
- Verify environment variables are set correctly

### Email confirmation not working
- In development, disable email confirmation in Supabase settings
- For production, configure a proper email provider (Sendgrid, AWS SES, etc.)

## Next Steps

1. Create a profile editing page at `/profile`
2. Integrate booking system with user authentication
3. Store bookings in a new `bookings` table linked to user profiles
4. Add password reset functionality
5. Implement social login (Google, Facebook, etc.) if needed

## Support

For issues with Supabase setup, visit:
- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Discord](https://discord.supabase.com)
