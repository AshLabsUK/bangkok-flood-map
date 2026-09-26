// Curated Thai -> English translation tables for the BMA road-flood sensor feed.
// Built by hand from floodbangkok.bangkok.go.th's public sensor_profile list (Sep 2026).
// Anything not covered here falls back to a lightly-cleaned pass-through of the Thai text
// (see translateLocation in bma-monitor.js) rather than a guess.

const DISTRICT_EN = {
  "คลองสาน": "Khlong San", "คลองเตย": "Khlong Toei", "คันนายาว": "Khan Na Yao",
  "จตุจักร": "Chatuchak", "จอมทอง": "Chom Thong", "ดอนเมือง": "Don Mueang",
  "ดินแดง": "Din Daeng", "ดุสิต": "Dusit", "ตลิ่งชัน": "Taling Chan",
  "ทุ่งครุ": "Thung Khru", "ธนบุรี": "Thon Buri", "บางกอกน้อย": "Bangkok Noi",
  "บางกอกใหญ่": "Bangkok Yai", "บางกะปิ": "Bang Kapi", "บางขุนเทียน": "Bang Khun Thian",
  "บางคอแหลม": "Bang Kho Laem", "บางซื่อ": "Bang Sue", "บางนา": "Bang Na",
  "บางบอน": "Bang Bon", "บางพลัด": "Bang Phlat", "บางรัก": "Bang Rak",
  "บางเขน": "Bang Khen", "บางแค": "Bang Khae", "บึงกุ่ม": "Bueng Kum",
  "ปทุมวัน": "Pathum Wan", "ประเวศ": "Prawet", "ป้อมปราบศัตรูพ่าย": "Pom Prap Sattru Phai",
  "พญาไท": "Phaya Thai", "พระนคร": "Phra Nakhon", "พระโขนง": "Phra Khanong",
  "ภาษีเจริญ": "Phasi Charoen", "มีนบุรี": "Min Buri", "ยานนาวา": "Yan Nawa",
  "ราชเทวี": "Ratchathewi", "ลาดกระบัง": "Lat Krabang", "ลาดพร้าว": "Lat Phrao",
  "วังทองหลาง": "Wang Thonglang", "วัฒนา": "Watthana", "สวนหลวง": "Suan Luang",
  "สัมพันธวงศ์": "Samphanthawong", "สาทร": "Sathon", "สายไหม": "Sai Mai",
  "หนองแขม": "Nong Khaem", "หลักสี่": "Lak Si", "ห้วยขวาง": "Huai Khwang",
  "สะพานสูง": "Saphan Sung", "หนองจอก": "Nong Chok", "คลองสามวา": "Khlong Sam Wa",
  "ราษฎร์บูรณะ": "Rat Burana", "บางพลี": "Bang Phli",
};

// district -> browsing zone (approximate grouping for the UI filter, not an official BMA boundary)
const DISTRICT_ZONE = {
  "Chatuchak":"north","Bang Sue":"north","Lak Si":"north","Sai Mai":"north","Don Mueang":"north","Bang Khen":"north","Lat Phrao":"north",
  "Phra Nakhon":"central","Pom Prap Sattru Phai":"central","Samphanthawong":"central","Dusit":"central","Din Daeng":"central",
  "Huai Khwang":"central","Ratchathewi":"central","Pathum Wan":"central","Wang Thonglang":"central","Phaya Thai":"central",
  "Bang Rak":"central","Yan Nawa":"central","Sathon":"central","Bang Kho Laem":"central","Phra Khanong":"central",
  "Khlong Toei":"central","Watthana":"central","Bang Na":"central","Suan Luang":"central","Prawet":"central",
  "Bang Kapi":"east","Bueng Kum":"east","Khan Na Yao":"east","Lat Krabang":"east","Min Buri":"east",
  "Nong Chok":"east","Khlong Sam Wa":"east","Saphan Sung":"east","Bang Phli":"east",
  "Thon Buri":"thonburi","Khlong San":"thonburi","Bangkok Yai":"thonburi","Bangkok Noi":"thonburi","Bang Phlat":"thonburi",
  "Taling Chan":"thonburi","Phasi Charoen":"thonburi","Bang Khae":"thonburi","Nong Khaem":"thonburi","Bang Khun Thian":"thonburi",
  "Bang Bon":"thonburi","Thung Khru":"thonburi","Chom Thong":"thonburi","Rat Burana":"thonburi",
};

const ROAD_EN = {
  "ซอยพหลโยธิน7": "Soi Phahonyothin 7", "ซอยรามคำแหง 43/1": "Soi Ramkhamhaeng 43/1",
  "ซอยลาดพร้าว 122": "Soi Lat Phrao 122", "ซอยลาดพร้าว64": "Soi Lat Phrao 64", "ซอยลาดพร้าว80": "Soi Lat Phrao 80",
  "ซอยสาธุประดิษฐ์15": "Soi Sathu Pradit 15",
  "ซอยสุขุมวิท 22": "Soi Sukhumvit 22", "ซอยสุขุมวิท 39": "Soi Sukhumvit 39", "ซอยสุขุมวิท26": "Soi Sukhumvit 26",
  "ซอยสุขุมวิท31": "Soi Sukhumvit 31", "ซอยสุขุมวิท39": "Soi Sukhumvit 39",
  "ถนนกำแพงเพชร 3": "Kamphaeng Phet 3 Road", "ถนนกำแพงเพชร": "Kamphaeng Phet Road",
  "ถนนงามวงค์วาน": "Ngamwongwan Road", "ถนนจรัญสนิทวงศ์": "Charan Sanitwong Road", "ถนนจอมทอง": "Chom Thong Road",
  "ถนนจันทน์": "Chan Road", "ถนนฉลองกรุง": "Chalong Krung Road", "ถนนฉิมพลี": "Chimphli Road",
  "ถนนช่างอากาศอุทิศ": "Changakat Uthit Road", "ถนนดินแดง": "Din Daeng Road", "ถนนท่าข้าม": "Tha Kham Road",
  "ถนนนครไชยศรี": "Nakhon Chai Si Road", "ถนนนวมินทร์": "Nawamin Road", "ถนนนาคนิวาส": "Nak Niwat Road",
  "ถนนนางลิ้นจี่": "Nang Linchi Road", "ถนนนิคมมักกะสัน": "Nikhom Makkasan Road",
  "ถนนบรมราชชนนี": "Borommaratchachonnani Road", "ถนนบรรทัดทอง": "Banthat Thong Road",
  "ถนนบางกระดี่": "Bang Kradi Road", "ถนนบางขุนเทียน": "Bang Khun Thian Road", "ถนนบางนา-ตราด": "Bang Na-Trat Road",
  "ถนนบางบอน": "Bang Bon Road",
  "ถนนประชาราษฎร์": "Pracharat Road", "ถนนประชาราษฎร์บำเพ็ญ": "Pracharat Bamphen Road", "ถนนประชาราษฏร์": "Pracharat Road",
  "ถนนประชาสงเคราะห์": "Pracha Songkhro Road", "ถนนประชาสุข": "Pracha Suk Road", "ถนนประชาอุทิศ": "Pracha Uthit Road",
  "ถนนประดิพัทธ์": "Pradiphat Road", "ถนนประดิษฐ์มนูธรรม": "Pradit Manutham Road", "ถนนประเสริฐมนูกิจ": "Prasert Manukitch Road",
  "ถนนผลาสินธุ์": "Phlasin Road",
  "ถนนเพลินจิต": "Ploenchit Road", "ถนนวิทยุ": "Witthayu (Wireless) Road", "ถนนพระราม 2": "Rama II Road",
  "ถนนสาทรเหนือ": "North Sathorn Road", "ถนนกาญจนาภิเษก": "Kanchanaphisek (Outer Ring) Road",
  "ถนนติวานนท์": "Tiwanon Road", "ถนนกรุงธนบุรี": "Krung Thon Buri Road",
  "ถนนนราธิวาสราชนครินทร์": "Naradhiwas Rajanagarindra Road", "ถนนสุขุมวิท 63": "Sukhumvit 63 (Ekkamai) Road",
  "ถนนสีลม 1": "Silom Soi 1", "ถนนงามวงศ์วาน 2": "Ngamwongwan 2 Road",
  "ถนนพญาไท": "Phaya Thai Road", "ถนนพระราม 1": "Rama I Road", "ถนนพระราม 3": "Rama III Road",
  "ถนนพระราม 4": "Rama IV Road", "ถนนพระราม 6": "Rama VI Road", "ถนนพระราม 9": "Rama IX Road",
  "ถนนพหลโยธิน": "Phahonyothin Road", "ถนนพัฒนาการ": "Phatthanakan Road", "ถนนมาเจริญ": "Ma Charoen Road",
  "ถนนรัชดาภิเษก": "Ratchadaphisek Road", "ถนนราชดำริ": "Ratchadamri Road", "ถนนราชวิถี": "Ratchawithi Road",
  "ถนนราชสีมา": "Ratchasima Road", "ถนนรามคำแหง": "Ramkhamhaeng Road", "ถนนรามอินทรา": "Ram Inthra Road",
  "ถนนลาดกระบัง": "Lat Krabang Road", "ถนนลาดปลาเค้า": "Lat Pla Khao Road", "ถนนลาดพร้าว": "Lat Phrao Road",
  "ถนนลาดพร้าววังหิน": "Lat Phrao Wang Hin Road", "ถนนลาดหญ้า": "Lat Ya Road",
  "ถนนวชิรธรรมสาธิต": "Wachirathamsathit Road", "ถนนวัชรพล": "Watcharaphon Road",
  "ถนนวิภาวดี(ขาออก)": "Vibhavadi Rangsit Road (outbound)", "ถนนวิภาวดีขาออก": "Vibhavadi Rangsit Road (outbound)",
  "ถนนวิสุทธิ์กษัตริย์": "Wisut Kasat Road", "ถนนศรีนครินทร์": "Srinagarindra Road", "ถนนศรีอยุธยา": "Si Ayutthaya Road",
  "ถนนศาลาแดง": "Sala Daeng Road", "ถนนสวนพลู": "Suan Phlu Road", "ถนนสาทรใต้": "South Sathorn Road",
  "ถนนสาธุประดิษฐ์": "Sathu Pradit Road", "ถนนสีลม": "Silom Road", "ถนนสีหบุรานุกิจ": "Sihaburanukit Road",
  "ถนนสุขาภิบาล": "Sukhaphiban Road", "ถนนสุขุมวิท 71": "Sukhumvit 71 Road", "ถนนสุขุมวิท": "Sukhumvit Road",
  "ถนนสุคนธสวัสดิ์": "Sukhonthasawat Road", "ถนนสุทธิสารวินิจฉัย": "Sutthisan Winitchai Road",
  "ถนนสุนทรโกษา": "Sunthon Kosa Road", "ถนนสุรวงศ์": "Surawong Road", "ถนนสุวินทวงศ์": "Suwinthawong Road",
  "ถนนหมู่บ้านเศรษฐกิจ": "Setthakit Village Road", "ถนนหลวง": "Luang Road", "ถนนหลวงแพ่ง": "Luang Phaeng Road",
  "ถนนหลานหลวง": "Lan Luang Road", "ถนนหัวหมาก": "Hua Mak Road", "ถนนอาจณรงค์": "At Narong Road",
  "ถนนอินทรพิทักษ์": "Inthraphithak Road", "ถนนอินทราภรณ์": "Intharaphon Road", "ถนนอิสรภาพ": "Itsaraphap Road",
  "ถนนอุดมสุข": "Udomsuk Road", "ถนนอโศกมนตรี": "Asok Montri Road", "ถนนอ่อนนุช": "On Nut Road",
  "ถนนเจริญกรุง": "Charoen Krung Road", "ถนนเจ้าคุณทหาร": "Chao Khun Thahan Road",
  "ถนนเฉลิมพระเกียรติ": "Chaloem Phrakiat Road", "ถนนเซนต์หลุยส์ 3": "St. Louis 3 Road",
  "ถนนเทพรักษ์": "Thepharak Road", "ถนนเทศบาลสงเคราะห์": "Thetsaban Songkhro Road",
  "ถนนเพชรบุรี": "Phetchaburi Road", "ถนนเพชรบุรีตัดใหม่": "New Phetchaburi Road", "ถนนเพชรเกษม": "Phetkasem Road",
  "ถนนเยาวราช": "Yaowarat Road", "ถนนเลียบคลองภาษีเจริญฝั่งเหนือ": "Liap Khlong Phasi Charoen Road (north bank)",
  "ถนนเลียบทางรถไฟสายใต้ฝั่ง(ขาออก)": "Road Along the Southern Railway (outbound side)",
  "ถนนเสนานิคม 1": "Senanikhom 1 Road", "ถนนเสรีไทย": "Seri Thai Road", "ถนนเอกชัย": "Ekkachai Road",
  "ถนนเอกมัย": "Ekkamai Road", "ถนนแจ้งวัฒนะ": "Chaeng Watthana Road", "ถนนโชคชัย": "Chok Chai Road",
};

// Common structural / landmark words found inside the free-text "name" (segment) field.
// Ordered longest-match-first at use time so multi-word phrases win over single tokens.
const PHRASE_EN = [
  ["ตรงข้ามหน้า", "opposite"], ["ตรงข้าม", "opposite"], ["ช่วงหน้า", "section in front of"],
  ["ช่วง", "section:"], ["หน้า", "in front of"], ["ใกล้", "near"], ["ปากซอย", "mouth of Soi"],
  ["ซอย", "Soi"], ["ซ.", "Soi "], ["ถ.", "Rd."], ["แยก", "junction"], ["สะพาน", "bridge"],
  ["คลอง", "khlong (canal)"], ["วัด", "Wat"], ["ตลาดสด", "fresh market"], ["ตลาด", "market"],
  ["มหาวิทยาลัย", "University"], ["โรงเรียน", "school"], ["ธนาคาร", "bank"], ["กรุงไทย", "Krungthai"],
  ["ปั๊มน้ำมัน", "petrol station"], ["หมู่บ้าน", "village"], ["ห้างสรรพสินค้า", "department store"],
  ["ห้าง", "mall"], ["วงเวียน", "roundabout"], ["สี่แยก", "intersection"], ["สามแยก", "T-junction"],
  ["ฝั่งขาเข้า", "(inbound side)"], ["ฝั่งขาออก", "(outbound side)"], ["ขาเข้า", "inbound"], ["ขาออก", "outbound"],
  ["กลับรถ", "U-turn"], ["ใต้ทางด่วน", "under the expressway"], ["ทางด่วน", "expressway"],
  ["สถานีตำรวจ", "police station"], ["โรงพยาบาล", "hospital"], ["สำนักงานเขต", "district office"],
];

if (typeof module !== "undefined") {
  module.exports = { DISTRICT_EN, DISTRICT_ZONE, ROAD_EN, PHRASE_EN };
}
