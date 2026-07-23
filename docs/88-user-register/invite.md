# invite.md
- create a new user with an invite code

## flow
1. admin wants to invite a new user to the system
2. admin generates an invite link and manually sends it to the new user
3. new user receives the invite link and uses it to register for an account

## invite code life cycle
- created by an admin
- manually sent to a new user as a url (e.g., https://d11.me/?auth=register&next=%2Fstart)
- can be used up to max_uses times to register new accounts
- expires after a certain period of time (e.g., 7 days)
- not tied to the users email address, so it can be used by anyone who has the code
- can be revoked by an admin

## UI
- create a new invite code with a note (optional) and an expiration date (default to 7 days)
- view a list of all invite codes with their status (use_count, max_uses, expired, revoked) and the note and expiration date
- copy to clipboard the invite code full url to send to a new user
- revoke an invite code (set revoked_at to now)

## registration flow
- new user clicks on the invite link and is taken to the registration page
- the invite code is passed as a query parameter in the url (e.g., https://d11.me/?auth=register&next=%2Fstart&invite=INVITE_CODE)

### Invalid invite codes
- if the invite code is invalid, expired, revoked, or has been used up, show an error message and do not allow the user to register
- ask them to contact the admin for a new invite code

### modify user registration flow to require an invite code for new users
- verify the invite code is valid and < max_uses
- increment use_count after successful registration

## modify admin.html
- add a new section for invite codes and create a new card for invite codes

## invite code generation
- Standard UUIDv4 or a cryptographically secure 32-character hex token works great here

## database schema 
Field	    Type	    Description
id	        UUID        / TEXT	Primary key
code	    VARCHAR(36)	Unique token indexed for quick lookup
created_by	FK	        Admin user ID who generated it
note	    TEXT	    Optional note (e.g., "For Sarah from Dev team")
max_uses	INTEGER	    Set to 1 for single-use (or N for group invites later)
use_count	INTEGER	    Defaults to 0; incremented on each successful sign-up
expires_at	TIMESTAMP	Default: NOW() + INTERVAL '7 days'
revoked_at	TIMESTAMP	Nullable; populated if an admin revokes the link

## Validation Query Logic
An invite link is considered valid if:
•	revoked_at IS NULL
•	expires_at > NOW()
•	use_count < max_uses

## Edge Case Checklist
•	Race Conditions: If two people open the same single-use link simultaneously, wrap the user-creation and use_count increment inside a database transaction to prevent double registrations.
•	Partial Form Fails: Only mark the code as used after the user account creation completely succeeds. If password validation fails on the sign-up form, the token remains unused and active.

## Implementation
- modify the existing user registration endpoint to accept an invite code parameter
- https://d11.me/?auth=register&next=%2Fstart&invite=INVITE_CODE
