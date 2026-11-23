import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const val = args[i + 1];
    params[key] = val;
  }
  return params;
}

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

async function migrate() {
  const { 'project-ref': projectRef, 'anon-key': anonKey, 'db-password': dbPassword, 'git-remote': gitRemote } = parseArgs();

  if (!projectRef || !anonKey) {
    console.error('Usage: node scripts/migrate-to-new-supabase.mjs --project-ref <REF> --anon-key <ANON_KEY> [--db-password <PASSWORD>] [--git-remote <GIT_URL>]');
    process.exit(1);
  }

  console.log('=== STARTING SUPABASE & GIT MIGRATION ===');
  console.log(`Target Project Ref: ${projectRef}`);

  // 1. Link Supabase CLI to new project
  console.log('\n[Step 1/6] Linking Supabase CLI to new project...');
  const linkCmd = dbPassword
    ? `npx supabase link --project-ref ${projectRef} --password "${dbPassword}"`
    : `npx supabase link --project-ref ${projectRef}`;
  run(linkCmd);

  // 2. Push all migrations to create schema
  console.log('\n[Step 2/6] Pushing database migrations (creating schema, tables, policies, functions)...');
  run('npx supabase db push --linked');

  // 3. Deploy edge functions
  console.log('\n[Step 3/6] Deploying edge functions...');
  try {
    run('npx supabase functions deploy admin-users');
  } catch (err) {
    console.warn('Warning: Edge function deployment failed or needs manual config:', err.message);
  }

  // 4. Import complete data (Old DB backup + Google Sheet data)
  console.log('\n[Step 4/6] Importing complete dataset into new Supabase project...');
  const migrationSqlPath = path.resolve('supabase/complete_migration_data.sql');
  run(`npx supabase db query --linked -f "${migrationSqlPath}"`);

  // 5. Update .env.local
  console.log('\n[Step 5/6] Updating .env.local with new Supabase URL & Key...');
  const envPath = path.resolve('.env.local');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(/VITE_SUPABASE_URL=.*/, `VITE_SUPABASE_URL=https://${projectRef}.supabase.co`);
  envContent = envContent.replace(/VITE_SUPABASE_ANON_KEY=.*/, `VITE_SUPABASE_ANON_KEY=${anonKey}`);
  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.log('Updated .env.local:');
  console.log(`VITE_SUPABASE_URL=https://${projectRef}.supabase.co`);

  // 6. Update git remote if provided
  if (gitRemote) {
    console.log(`\n[Step 6/6] Updating git remote origin to ${gitRemote}...`);
    run(`git remote set-url origin ${gitRemote}`);
  } else {
    console.log('\n[Step 6/6] Git remote was not changed (no --git-remote provided).');
  }

  // 7. Verify codebase
  console.log('\n=== RUNNING CODEBASE VERIFICATION CHECKS ===');
  run('yarn tsc -b');
  run('yarn lint');
  run('yarn test');
  run('yarn i18n:check');
  run('yarn build');

  console.log('\n✅ MIGRATION COMPLETED SUCCESSFULLY!');
}

migrate().catch(err => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
