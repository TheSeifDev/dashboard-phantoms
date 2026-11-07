import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envContent.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1)];
    })
);

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY
);



const REALISTIC_NAMES = [
  'أحمد محمد عبد الله',
  'سارة محمود مصطفى',
  'كريم طارق حسن',
  'نورهان سمير علي',
  'محمد إبراهيم صالح',
  'فاطمة عبد الرحمن كمال',
  'عمر هشام رشاد',
  'مريم يوسف جمال',
  'خالد عبد العزيز محمود',
  'ياسمين أحمد فوزي',
  'محمود عادل إبراهيم',
  'هدى كمال الدين حسن',
  'طارق سعيد منصور',
  'رانيا محمد عبد الخالق',
  'حسن مصطفى عبد اللطيف'
];

const BIOS = [
  'مهندس برمجيات واجهات خلفية',
  'مطور واجهات أمامية (React)',
  'متخصص في أمن المعلومات',
  'مهندس بيانات ضخمة',
  'مصمم واجهات وتجربة مستخدم (UI/UX)',
  'مدير منتجات تقنية',
  'متخصص دعم فني',
  'محلل نظم أعمال'
];

const RESIDENCES = ['القاهرة', 'الجيزة', 'الإسكندرية', 'المنصورة', 'طنطا', 'أسيوط', 'الزقازيق'];
const DEVICES = ['لابتوب', 'كمبيوتر', 'هاتف', 'لابتوب,هاتف', 'بدون'];
const WORK_STATUSES = ['active', 'inactive'];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function seed() {
  console.log('Fetching existing members...');
  const { data: members, error: fetchError } = await supabase
    .from('members')
    .select('*');

  if (fetchError) {
    console.error('Error fetching members:', fetchError);
    return;
  }

  console.log(`Found ${members.length} members. Updating with realistic data...`);

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    
    const updates = {
      full_name: REALISTIC_NAMES[i % REALISTIC_NAMES.length] + (i >= REALISTIC_NAMES.length ? ` ${i}` : ''),
      bio: randomChoice(BIOS),
      residence: randomChoice(RESIDENCES),
      device: randomChoice(DEVICES),
      work_status: randomChoice(WORK_STATUSES),
      can_go_alexandria: Math.random() > 0.5,
      work_conditions: randomChoice(['دوام كامل', 'دوام جزئي', 'عن بعد']),
    };

    const { error: updateError } = await supabase
      .from('members')
      .update(updates)
      .eq('id', member.id);

    if (updateError) {
      console.error(`Error updating member ${member.id}:`, updateError);
    } else {
      console.log(`Updated member ${member.id} -> ${updates.full_name}`);
    }
  }

  // If there are less than 12 members, insert some new ones
  if (members.length < 12) {
    const toInsert = 12 - members.length;
    console.log(`Inserting ${toInsert} new members...`);
    
    for (let i = 0; i < toInsert; i++) {
      const idx = members.length + i;
      const newMember = {
        email: `member${idx}@example.com`,
        full_name: REALISTIC_NAMES[idx % REALISTIC_NAMES.length],
        bio: randomChoice(BIOS),
        residence: randomChoice(RESIDENCES),
        device: randomChoice(DEVICES),
        work_status: randomChoice(WORK_STATUSES),
        can_go_alexandria: Math.random() > 0.5,
        work_conditions: randomChoice(['دوام كامل', 'دوام جزئي', 'عن بعد']),
      };
      
      const { error: insertError } = await supabase
        .from('members')
        .insert([newMember]);
        
      if (insertError) {
        console.error(`Error inserting member ${idx}:`, insertError);
      } else {
        console.log(`Inserted new member -> ${newMember.full_name}`);
      }
    }
  }

  console.log('Seed complete!');
}

seed();
