# Portfolio — fully linked (contact form + admin editor)

index.html            your portfolio (loads edits from /api/content, sends the form to /api/contact)
admin/index.html      your admin page  ->  yoursite.vercel.app/admin
api/contact.js        contact form backend (saves to Supabase, emails you)
api/admin.js          admin backend (login, edit content, upload files, read messages)
api/content.js        public endpoint that feeds your edits to the portfolio
brewnest/index.html   live BrewNest website ("View Project" button)
supabase-setup.sql    creates both database tables (run once)
vercel.json  package.json  .gitignore  .env.example

SETUP
1. Supabase: SQL Editor -> paste supabase-setup.sql -> Run.
   Project Settings -> API: copy Project URL + service_role key.
2. Resend: API Keys -> Create -> copy the key.
3. Vercel: Add New -> Project -> import this repo -> add the 5 variables from .env.example -> Deploy.
   (Added variables later? Deployments -> Redeploy.)
4. Test: send a contact message; open /admin, log in with ADMIN_PASSWORD.
