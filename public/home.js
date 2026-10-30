const form=document.querySelector('#join-form'),input=document.querySelector('#join-code'),error=document.querySelector('#home-error');
input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(0,6);error.textContent=''});
form.addEventListener('submit',event=>{event.preventDefault();const code=input.value.trim();if(!/^\d{6}$/.test(code)){error.textContent='Enter all six digits.';return}location.href=`/join/${code}`});
