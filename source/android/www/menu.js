/* Accessible drop-down menus for the top bar. Items keep their own click handlers. */
(function(){
'use strict';
const menus=[...document.querySelectorAll('.menu')];
function items(list){return [...list.querySelectorAll('[role="menuitem"]')].filter(item=>!item.disabled&&!item.classList.contains('hidden'));}
function close(menu,focusTrigger){const trigger=menu.querySelector('.menu-trigger'),list=menu.querySelector('.menu-list');if(list.hidden)return;list.hidden=true;trigger.setAttribute('aria-expanded','false');if(focusTrigger)trigger.focus();}
function open(menu,focusLast){menus.forEach(other=>other!==menu&&close(other));const trigger=menu.querySelector('.menu-trigger'),list=menu.querySelector('.menu-list');list.hidden=false;trigger.setAttribute('aria-expanded','true');const all=items(list);(focusLast?all[all.length-1]:all[0])?.focus();}
for(const menu of menus){
  const trigger=menu.querySelector('.menu-trigger'),list=menu.querySelector('.menu-list');
  trigger.addEventListener('click',()=>list.hidden?open(menu):close(menu));
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open(menu,event.key==='ArrowUp');}});
  list.addEventListener('keydown',event=>{
    const all=items(list),index=all.indexOf(document.activeElement);
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(menu,true);}
    else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const step=event.key==='ArrowDown'?1:-1;all[(index+step+all.length)%all.length]?.focus();}
    else if(event.key==='Home'||event.key==='End'){event.preventDefault();all[event.key==='Home'?0:all.length-1]?.focus();}
    else if(event.key==='Tab')close(menu);
  });
  list.addEventListener('click',event=>{if(event.target.closest('[role="menuitem"]'))close(menu);});
}
document.addEventListener('pointerdown',event=>{for(const menu of menus)if(!menu.contains(event.target))close(menu);});
window.addEventListener('blur',()=>menus.forEach(menu=>close(menu)));
})();
