import jsforce from 'jsforce';

const USERNAME = 'jim1@bcafinancialgroup.com';
const PASSWORD = '2@Rockwell';
const TOKEN = 'V1Gwa74ZzDkwhzEMxvlNsaIrx';
const LOGIN_URL = 'https://login.salesforce.com';

console.log('Testing Salesforce login...');
console.log('Username:', USERNAME);
console.log('Login URL:', LOGIN_URL);
console.log('Password + Token:', PASSWORD + TOKEN);

const conn = new jsforce.Connection({ loginUrl: LOGIN_URL });

try {
  const result = await conn.login(USERNAME, PASSWORD + TOKEN);
  console.log('\n✅ SUCCESS! Login worked.');
  console.log('User ID:', result.id);
  console.log('Org ID:', result.organizationId);
} catch (err) {
  console.log('\n❌ FAILED:', err.message);
}
