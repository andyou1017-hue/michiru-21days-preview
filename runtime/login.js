'use strict';
document.getElementById('login-form').addEventListener('submit', async function (event) {
  event.preventDefault();
  const button = document.getElementById('submit'), message = document.getElementById('login-message');
  const email = document.getElementById('email').value, password = document.getElementById('password').value, invite = document.getElementById('invite').value.trim();
  button.disabled = true; message.textContent = '確認しています…';
  try {
    const response = await fetch(invite ? '/api/enroll' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, invite }) });
    const result = await response.json();
    if (!response.ok) { message.textContent = result.error || 'ログインできませんでした。'; return; }
    location.replace('/');
  } catch (_) { message.textContent = '通信できませんでした。接続を確認して、もう一度お試しください。'; }
  finally { button.disabled = false; }
});
