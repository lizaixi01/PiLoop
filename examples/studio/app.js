const menu = document.querySelector('#menu');
const panel = document.querySelector('#menu-panel');
menu.addEventListener('click', () => { panel.hidden = !panel.hidden; menu.setAttribute('aria-expanded', String(!panel.hidden)); });
document.querySelector('.read').addEventListener('click', function () { const body = document.querySelector('.body'); body.hidden = !body.hidden; this.setAttribute('aria-expanded', String(!body.hidden)); });
