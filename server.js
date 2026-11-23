import express from 'express';
import {WebSocketServer,WebSocket} from 'ws';
import {createServer} from 'node:http';
import {randomUUID,randomInt} from 'node:crypto';
const app=express();app.use(express.static('public'));const server=createServer(app);const wss=new WebSocketServer({server,path:'/ws'});
const rooms=new Map(),sessions=new Map();
const names=['СТАРТ','Київ','Скарбниця','Чернігів','Податок','Вокзал Північ','Суми','Шанс','Полтава','Харків','ВІДПОЧИНОК','Дніпро','Електростанція','Запоріжжя','Кривий Ріг','Вокзал Схід','Одеса','Скарбниця','Миколаїв','Херсон','ВʼЯЗНИЦЯ','Львів','Шанс','Тернопіль','Івано-Франківськ','Вокзал Захід','Луцьк','Водоканал','Рівне','Ужгород','ПАРКІНГ','Чернівці','Кропивницький','Скарбниця','Вінниця','Вокзал Південь','Черкаси','Шанс','Житомир','Хмельницький'];
const groups=[1,3,6,8,9,11,13,14,16,18,19,21,23,24,26,28,29,31,32,34,36,38,39];
const price=i=>[5,15,25,35].includes(i)?200:i===12||i===27?150:groups.includes(i)?Math.round((80+i*11)/10)*10:0;
const settings={classic:{cash:1500,salary:200,rent:1},fast:{cash:1200,salary:200,rent:1.5},rich:{cash:3000,salary:300,rent:1},hard:{cash:900,salary:150,rent:2}};
function safe(s){return String(s||'Гравець').replace(/[<>\u0000-\u001f]/g,'').slice(0,28)}
function send(ws,o){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o))}
function broadcast(r){for(const p of r.players)send(sessions.get(p.id),{type:'state',state:publicState(r),you:p.id})}
function publicState(r){return {code:r.code,mode:r.mode,status:r.status,turn:r.turn,phase:r.phase,roll:r.roll,log:r.log.slice(-12),players:r.players.map(({id,name,pos,cash,owned,bankrupt,jailed})=>({id,name,pos,cash,owned,bankrupt,jailed})),properties:r.properties,tiles:names,prices:names.map((_,i)=>price(i)),winner:r.winner||null}}
function next(r){let tries=0;do{r.turn=(r.turn+1)%r.players.length;tries++}while(r.players[r.turn].bankrupt&&tries<=r.players.length);r.phase='roll';r.roll=null}
function note(r,s){r.log.push(s);if(r.log.length>40)r.log.shift()}
function bankrupt(r,p){p.bankrupt=true;p.cash=0;for(const i of p.owned)delete r.properties[i];p.owned=[];note(r,`💀 ${p.name} збанкрутував`);const alive=r.players.filter(x=>!x.bankrupt);if(alive.length===1){r.status='finished';r.winner=alive[0].name;note(r,`🏆 Переможець: ${r.winner}`)}}
function debit(r,p,amount,recipient){p.cash-=amount;if(recipient)recipient.cash+=amount;if(p.cash<0)bankrupt(r,p)}
function action(r,p,kind){const cfg=settings[r.mode];if(kind==='roll'){
 if(r.phase!=='roll')throw Error('Зараз не можна кидати кубики');const a=randomInt(1,7),b=randomInt(1,7);r.roll=[a,b];let n=a+b;const old=p.pos;p.pos=(p.pos+n)%40;if(p.pos<old){p.cash+=cfg.salary;note(r,`💰 ${p.name} отримав ${cfg.salary} ₴ за СТАРТ`)}note(r,`🎲 ${p.name}: ${a}+${b} → ${names[p.pos]}`);const i=p.pos;
 if(i===30){p.pos=10;debit(r,p,50);note(r,'🚔 Штраф за вʼязницю: 50 ₴')}
 else if(i===4||i===38){debit(r,p,i===4?100:200);note(r,'💸 Сплачено податок')}
 else if([2,7,17,22,33,37].includes(i)){const delta=randomInt(-100,151);p.cash+=delta;note(r,`${delta>=0?'🎁':'💸'} Подія: ${delta>=0?'+':''}${delta} ₴`);if(p.cash<0)bankrupt(r,p)}
 else if(price(i)>0){const ownerId=r.properties[i];if(ownerId&&ownerId!==p.id){const owner=r.players.find(x=>x.id===ownerId);const rent=Math.round(price(i)*0.15*cfg.rent);debit(r,p,rent,owner);note(r,`🏠 Оренда ${owner.name}: ${rent} ₴`)}else if(!ownerId&&p.cash>=price(i))r.phase='buy'}
 if(r.phase!=='buy')r.phase='end';
 }else if(kind==='buy'){if(r.phase!=='buy')throw Error('Немає доступної покупки');const i=p.pos;if(r.properties[i]||!price(i)||p.cash<price(i))throw Error('Неможливо купити');p.cash-=price(i);p.owned.push(i);r.properties[i]=p.id;note(r,`🏘️ ${p.name} купив ${names[i]} за ${price(i)} ₴`);r.phase='end'}
 else if(kind==='skip'){if(r.phase!=='buy')throw Error('Немає покупки');r.phase='end'}
 else if(kind==='end'){if(r.phase!=='end')throw Error('Спочатку завершіть дію');next(r)}
 else throw Error('Невідома дія');
 if(r.status==='finished')r.phase='finished';
}
function code(){let s;do{s=String(randomInt(100000,1000000))}while(rooms.has(s));return s}
wss.on('connection',ws=>{let identity=null;ws.on('message',raw=>{try{const m=JSON.parse(String(raw));if(!m||typeof m!=='object')return;if(m.type==='create'||m.type==='join'){
 if(identity)throw Error('Ви вже в кімнаті');let r;if(m.type==='create'){if(!settings[m.mode])throw Error('Невідомий режим');const c=code();r={code:c,mode:m.mode,status:'lobby',turn:0,phase:'roll',roll:null,players:[],properties:{},log:[]};rooms.set(c,r)}else{r=rooms.get(String(m.code||''));if(!r)throw Error('Кімнату не знайдено');if(r.status!=='lobby')throw Error('Гра вже розпочалася');if(r.players.length>=6)throw Error('Кімната заповнена')}
 const id=randomUUID();identity={code:r.code,id};sessions.set(id,ws);r.players.push({id,name:safe(m.name),pos:0,cash:settings[r.mode].cash,owned:[],bankrupt:false,jailed:false});note(r,`👋 ${safe(m.name)} приєднався`);broadcast(r)
 }else if(m.type==='start'||m.type==='action'){if(!identity)throw Error('Спочатку увійдіть до кімнати');const r=rooms.get(identity.code);if(!r)throw Error('Кімната закрита');const idx=r.players.findIndex(p=>p.id===identity.id);if(idx<0)throw Error('Гравця не знайдено');if(m.type==='start'){if(r.status!=='lobby'||idx!==0||r.players.length<2)throw Error('Почати може організатор, потрібно 2–6 гравців');r.status='playing';note(r,'🎩 Гру розпочато!')}else{if(r.status!=='playing'||r.turn!==idx)throw Error('Зараз не ваш хід');action(r,r.players[idx],m.kind)}broadcast(r)}
 }catch(e){send(ws,{type:'error',message:e.message})}});ws.on('close',()=>{if(!identity)return;sessions.delete(identity.id);const r=rooms.get(identity.code);if(!r)return;if(r.status==='lobby'){r.players=r.players.filter(p=>p.id!==identity.id);if(!r.players.length)rooms.delete(r.code);else broadcast(r)}else{note(r,'📴 Гравець відключився; партію призупинено для нього');broadcast(r)}})});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Monopoly Ukraine running on',process.env.PORT||3000));
