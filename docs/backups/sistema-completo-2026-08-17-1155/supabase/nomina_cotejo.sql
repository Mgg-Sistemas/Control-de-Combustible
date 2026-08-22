-- COTEJO NÓMINA (fuente: TABULADOR CON SUELDO BASE .xlsx · hoja NOMINA GENERAL)
-- Empareja por CÉDULA (solo dígitos). Idempotente. 100 personas · 93 con cuenta · 42 con cargo.
-- Solo toca filas cuya cédula EXISTA en employees (si no existe, no cambia nada). Revisa antes de correr.

-- ===== 1) BANCO + Nº DE CUENTA =====
update public.employees set bank_name='BANCO BANCAMIGA', bank_account='01720110711109626331' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20127237'; -- MOISES MORA
update public.employees set bank_name='BANCO BANESCO', bank_account='01340946340001541922' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16105037'; -- DORIANNE PEREZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020128460000408767' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='21192049'; -- AGATHA MENDOZA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020556520000012658' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20301176'; -- JESMARY BARCO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020128410101302858' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19797351'; -- GENESIS PANTOJA
update public.employees set bank_name='BANCO BNC', bank_account='01910155032100015101' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16944659'; -- CLARK MENDEZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020101230000050377' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13233018'; -- GUILLERMO ORTEGA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020632480100008421' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='15908772'; -- ELISEO AZUAJE
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020488760000134578' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13865291'; -- GUIOVANI MALAVE
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020540940000389996' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='17921786'; -- SULEIDY ARIENTA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020169120000228277' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18389076'; -- LEIDDY APONTE
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020540950001130995' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='25625148'; -- AURIS ROMERO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020456910000614454' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='32508511'; -- NILIANY VIERA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020876960100006726' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13068557'; -- CARMEN LOPEZ
update public.employees set bank_name='BANCO BANESCO', bank_account='01340946380001308832' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='34496691'; -- BRAYAN NIÑO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020103960001121072' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='27200172'; -- JEFFERSON FLORES
update public.employees set bank_name='BANCO BANESCO', bank_account='01340361993611037316' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='17921688'; -- NELSON ARIENTA
update public.employees set bank_name='BANCO BANCAMIGA', bank_account='01720153111535064750' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18729223'; -- DIANA DE LA RANS
update public.employees set bank_name='BANCO VENEZUELA CORRIENTE', bank_account='01020467430000361231' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20088035'; -- VIVIANA VELASQUEZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020640530000119111' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='9904893'; -- OSCAR JOEL GOMEZ
update public.employees set bank_name='BANESCO', bank_account='01340428374283039854' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='24638635'; -- ARTURO YAGUE
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020133130100044477' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12618127'; -- RAMON MARTINEZ
update public.employees set bank_name='BANCO MERCANTIL', bank_account='01050152181152033069' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='26869562'; -- RAFAEL ALVAREZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020868800000037219' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13701934'; -- HUGO LOPEZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020300730000172187' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19915404'; -- JOSE PEDRON
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020384810100073866' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='14015596'; -- BERNI VERDU
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020364300000623380' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='14128163'; -- FRANKY LORETO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020501810007055595' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='10825000'; -- JUAN VARGAS
update public.employees set bank_name='BANCO FONDO COMUN', bank_account='01510114825501262412' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='10583795'; -- ALBERTO SILVA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020261290000538174' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='6489375'; -- JESUS RAMON VARGAS
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020540930000136945' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='32543147'; -- ALEXANDER VARGAS
update public.employees set bank_name='BANCO BNC', bank_account='01910060041160009380' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13265190'; -- ENDER RAGA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020103940000729161' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='11161089'; -- GILBERTO GARCIA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020722350000004569' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18850154'; -- JOSE GUZMAN
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020103940001072697' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='32490969'; -- ANGELO MUÑOZ
update public.employees set bank_name='BANCO BDT', bank_account='01750500910073521702' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12047650'; -- MIGUEL SUAREZ
update public.employees set bank_name='BANCO MERCANTIL', bank_account='01050185751185253556' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12322417'; -- RAFAEL SANCHEZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020764940000010870' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='9193324'; -- CARLOS GARCIA
update public.employees set bank_name='BANCO FONDO COMUN', bank_account='01510006164449020751' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='10071115'; -- RAMON VEITIA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020722390000020381' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='22782509'; -- JOSE ARGEL
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020501800109383109' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19397696'; -- FRANCISCO VILLEGAS
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020475510000383073' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='9956815'; -- FRANCISCO MAYORA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020475500000293477' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20781094'; -- REYMOND MARTINEZ
update public.employees set bank_name='BANCO BNC', bank_account='01910052911152005515' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='5547855'; -- CARLOS CASTILLO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020910260100003221' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13375582'; -- JOSE GUEVARA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020229900000251846' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='8983916'; -- QUENIS SIFONTES
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020128440000973179' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='29910514'; -- JOSE ANGEL PLACENCIA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020398880000247708' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='9623571'; -- LORENZO RIVERO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020501820007387849' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='14322710'; -- JACKSON GARCIA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020109840000717856' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20103268'; -- DOUGLAS URIBE
update public.employees set bank_name='BANCO BNC', bank_account='01910295542100031509' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='30482425'; -- LUIS URIBE
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020358910100033745' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18170907'; -- CARLOS HERNANDEZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020676650000095549' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16701441'; -- NELSON GUTIERREZ
update public.employees set bank_name='BANCO DEL TESORO', bank_account='01630219872197004818' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12163821'; -- GUILLERMO FERREIROA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020586720000063649' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='14143899'; -- NESTOR YRIARTE
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020586720000151276' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19796036'; -- RICHARD GARCIA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020352070000946067' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20411709'; -- CARLOS PERDORMO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020613810000196752' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19782354'; -- JOSE GUERRA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020257410000103334' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='15890995'; -- PEDRO SANDOVAL
update public.employees set bank_name='BANCO BANPLUS', bank_account='01740116511164059568' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13684307'; -- FELIPE ALGUERA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020131410000252968' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='11973051'; -- GERARDO ROA
update public.employees set bank_name='BANCO VENEZOLANO DE CREDITO', bank_account='01040019860190162931' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18425462'; -- ENDER MEJIA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020636750000193629' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20887610'; -- YORWINS ROJA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020475560000932217' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='22336277'; -- JOSE MANUEL (WANSHINTON) ROMERO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020300750000009988' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18358928'; -- CESAR FLAMES
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020497620104979867' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='84393609'; -- REMBERTO ROJAS
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020634110000348241' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='27733898'; -- FRANK NARROS
update public.employees set bank_name='BANCO MERCANTIL', bank_account='01050650691650094256' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19388088'; -- ANGEL LAICIAGA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020401110100038846' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16945229'; -- DANIEL JIMENEZ
update public.employees set bank_name='BANCO BANESCO', bank_account='01340866190001403745' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='29609492'; -- ROBINSSON ROA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020586720000586427' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='31790090'; -- WILDEIBER ROA
update public.employees set bank_name='BANCO BANESCO', bank_account='01340213242132192071' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19388836'; -- ALEJANDRO GARCIA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020128440101299675' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='32360901'; -- WILBERT MORIN
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020209410000122904' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='14567298'; -- JOHAN PROIETTO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020475580000135917' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13514901'; -- ISRAEL JAIMES
update public.employees set bank_name='BANCO MERCANTIL', bank_account='01050219530219095949' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='32272785'; -- JESUS GUERRA
update public.employees set bank_name='BANCO DEL TEDORO', bank_account='01630900179005115525' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='11638760'; -- LUIS SALAZAR
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020471240000154956' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12975119'; -- ALBERTO VALDEZ
update public.employees set bank_name='BANCO BANESCO', bank_account='01340072530723055518' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='6185823'; -- BARDIS JAIME
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020275210100011434' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='10010514'; -- JESUS GUERRA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020263930000114909' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='14313909'; -- EDIONIS MORA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020275210100011434' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16673328'; -- MAYKER NARVAEZ
update public.employees set bank_name='BANCO BANESCO-CORRIENTE', bank_account='01340945539461360346' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12259398'; -- DANIEL MACHADO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020724080000042929' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13719163'; -- RAMON VILLAMIZAR
update public.employees set bank_name='BANCO DE VENEZUELA', bank_account='01020872660000127695' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18331581'; -- FRANK AMARISTA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020169180000538747' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='31080268'; -- ELVIS TOVAR
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020169110000993269' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='30510795'; -- JEISON DIAZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020695260000054551' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18756375'; -- ANDERSON DAVILA
update public.employees set bank_name='BANCO BNC Cta.Corriente:', bank_account='01910056162156132782' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='31962181'; -- EDERSON MORA
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020475580000510558' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19123196'; -- DAIKAR BOLIVAR
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020501830006668705' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='27772359'; -- GREISY BRACHO
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020209410000070917' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16310598'; -- YENNY HERNANDEZ
update public.employees set bank_name='BANCO VENEZUELA', bank_account='01020476370000145965' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20887745'; -- YULCELYS VERA

-- ===== 2) CARGO (solo los que traían cargo en la hoja; typos corregidos) =====
update public.employees set cargo='COORDINADOR GENERAL' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20127237'; -- MOISES MORA
update public.employees set cargo='JEFE DE ADMINISTRACION' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16105037'; -- DORIANNE PEREZ
update public.employees set cargo='ANALISTA ADMINISTRATIVOS' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='21192049'; -- AGATHA MENDOZA
update public.employees set cargo='ANALISTA ADMINISTRATIVOS' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20301176'; -- JESMARY BARCO
update public.employees set cargo='ANALISTA ADMINISTRATIVOS' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19797351'; -- GENESIS PANTOJA
update public.employees set cargo='JEFE DE OPERACIONES DE MAQUINARIA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='9904893'; -- OSCAR JOEL GOMEZ
update public.employees set cargo='COORDINADOR DE OPERADORES' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12618127'; -- RAMON MARTINEZ
update public.employees set cargo='OPERADORES DE MAQUINARIA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18850154'; -- JOSE GUZMAN
update public.employees set cargo='OPERADORES DE MAQUINARIA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='9623571'; -- LORENZO RIVERO
update public.employees set cargo='OPERADORES DE MAQUINARIA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18170907'; -- CARLOS HERNANDEZ
update public.employees set cargo='CHOFER DE CISTERNA DE AGUA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12163821'; -- GUILLERMO FERREIROA
update public.employees set cargo='CHOFER DE CISTERNA DE AGUA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='15890995'; -- PEDRO SANDOVAL
update public.employees set cargo='JEFE DE PATIO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='11973051'; -- GERARDO ROA
update public.employees set cargo='COORDINADOR DE INSPECTOR' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18425462'; -- ENDER MEJIA
update public.employees set cargo='COORDINADOR DE INSPECTOR' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='20887610'; -- YORWINS ROJA
update public.employees set cargo='INSPECTOR DE EQUIPOS' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='22336277'; -- JOSE MANUEL (WANSHINTON) ROMERO
update public.employees set cargo='INSPECTOR DE EQUIPOS' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18358928'; -- CESAR FLAMES
update public.employees set cargo='INSPECTOR DE EQUIPOS' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='84393609'; -- REMBERTO ROJAS
update public.employees set cargo='INSPECTOR DE EQUIPOS' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='27733898'; -- FRANK NARROS
update public.employees set cargo='MECANICO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19388088'; -- ANGEL LAICIAGA
update public.employees set cargo='COORDINADOR DE MANTENIMIENTO PREVENTIVO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16945229'; -- DANIEL JIMENEZ
update public.employees set cargo='OPERADOR DE CAMION DE SERVICIO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='29609492'; -- ROBINSSON ROA
update public.employees set cargo='OPERADOR DE CAMION DE SERVICIO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='31790090'; -- WILDEIBER ROA
update public.employees set cargo='OPERADOR DE CAMION DE SERVICIO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19388836'; -- ALEJANDRO GARCIA
update public.employees set cargo='AYUDANTE DE CAMION DE SERVICIO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='34022074'; -- WILDERSON ROA
update public.employees set cargo='AYUDANTE DE CAMION DE SERVICIO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='32360901'; -- WILBERT MORIN
update public.employees set cargo='COORDINADOR DE ELECTRICISTA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='14567298'; -- JOHAN PROIETTO
update public.employees set cargo='ELECTRICISTA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13514901'; -- ISRAEL JAIMES
update public.employees set cargo='AYUDANTE ELECTRICISTA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='32272785'; -- JESUS GUERRA
update public.employees set cargo='AYUDANTE ELECTRICISTA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='11638760'; -- LUIS SALAZAR
update public.employees set cargo='SOLDADOR CERTIFICADO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='12975119'; -- ALBERTO VALDEZ
update public.employees set cargo='MOTORIZADO VIP' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16673328'; -- MAYKER NARVAEZ
update public.employees set cargo='TODERO' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='13719163'; -- RAMON VILLAMIZAR
update public.employees set cargo='OBRERO (CALETERO)' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18331581'; -- FRANK AMARISTA
update public.employees set cargo='OBRERO (CALETERO)' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='31080268'; -- ELVIS TOVAR
update public.employees set cargo='OBRERO (CALETERO)' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='30510795'; -- JEISON DIAZ
update public.employees set cargo='OBRERO (CALETERO)' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='18756375'; -- ANDERSON DAVILA
update public.employees set cargo='OBRERO (CALETERO)' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='31962181'; -- EDERSON MORA
update public.employees set cargo='OBRERO (CALETERO)' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='29768914'; -- YONAIKER ESCALONA
update public.employees set cargo='MANTENIMIENTO Y LIMPIEZA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='19123196'; -- DAIKAR BOLIVAR
update public.employees set cargo='MANTENIMIENTO Y LIMPIEZA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='27772359'; -- GREISY BRACHO
update public.employees set cargo='MANTENIMIENTO Y LIMPIEZA' where regexp_replace(coalesce(cedula,''),'[^0-9]','','g')='16310598'; -- YENNY HERNANDEZ

-- ===== 3) REVISAR A MANO — sin cuenta de 20 dígitos en el Excel (7) =====
--   18712513  ALVARO GUTIERREZ  ·  crudo: "46224.0"
--   4956140  JAIME SEPULVEDA  ·  crudo: "46224.0"
--   11759260  NELSON CALDERON  ·  crudo: "46224.0"
--   10238440  ISRAEL URDANETA  ·  crudo: "BANCO DIGITAL DE LOS TRABAJADORES 6031220000010152083 ISRAEL URDANETA V- 10.238.440"
--   34022074  WILDERSON ROA  ·  crudo: "46199.0"
--   6889628  JHON ROMERO  ·  crudo: "46225.0"
--   29768914  YONAIKER ESCALONA  ·  crudo: "650"

-- NOTA: 58 personas venían SIN cargo en NOMINA GENERAL; su cargo NO se toca aquí.
