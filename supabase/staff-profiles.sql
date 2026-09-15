-- Authentication > Users에 모든 계정을 먼저 생성한 뒤 실행하세요.
-- 이메일은 반드시 사번@d5.local 형식이어야 합니다.

update public.profiles p set employee_no=v.employee_no, display_name=v.display_name, role=v.role::public.app_role, position_label=v.position_label, updated_at=now()
from (values
  ('12784','D5 관리자','admin','관리자'),
  ('19447','백현승','manager','매니저'),
  ('19653','한동민','manager','매니저'),
  ('19010','왕세훈','manager','매니저'),
  ('19407','김민범','manager','매니저'),
  ('19348','복기철','manager','매니저'),
  ('16798','오원석','manager','매니저'),
  ('18322','안동수','manager','매니저'),
  ('17399','김대식','manager','매니저'),
  ('18554','이지민','manager','매니저'),
  ('18534','장세웅','manager','매니저'),
  ('17838','김대웅','manager','매니저'),
  ('19459','강혁훈','manager','매니저'),
  ('18327','소영호','manager','매니저'),
  ('16855','장형철','manager','매니저'),
  ('18501','권혁민','manager','매니저'),
  ('17348','변진호','manager','매니저'),
  ('13783','우길수','manager','매니저'),
  ('13965','박준덕','manager','매니저'),
  ('12237','이동진','store_manager','지점장'),
  ('11768','백도현','assistant_manager','부지점장'),
  ('13026','강동화','assistant_manager','부지점장'),
  ('13839','오인탁','assistant_manager','부지점장'),
  ('13240','김지성','assistant_manager','부지점장'),
  ('14826','김종현','assistant_manager','부지점장')
) as v(employee_no,display_name,role,position_label)
join auth.users u on lower(u.email)=lower(v.employee_no || '@d5.local')
where p.id=u.id;
