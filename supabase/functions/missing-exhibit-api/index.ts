import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cleanName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
const token = () => crypto.randomUUID() + "." + crypto.randomUUID();
async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, "0")).join("");
}
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const data = new Uint8Array(6);
  crypto.getRandomValues(data);
  return [...data].map(v => chars[v % chars.length]).join("");
}
function safeState(v: Record<string, unknown>) {
  return { security_solved: v.security_solved === true, archive_unlocked: v.archive_unlocked === true, clue_found: v.clue_found === true };
}
function near(player: {x:number;y:number}, x:number, y:number) {
  return Math.hypot(player.x - x, player.y - y) <= 20;
}
async function getPlayer(client: ReturnType<typeof db>, id: unknown, session: unknown) {
  if (typeof id !== "string" || typeof session !== "string" || session.length < 30) return null;
  const { data } = await client.from("exhibit_players")
    .select("id,room_id,name,room_key,x,y,inventory,evidence,token_hash")
    .eq("id", id).eq("token_hash", await digest(session)).maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({error:"Method not allowed"},405);

  try {
    const body = await req.json();
    const client = db();

    if (body.action === "create" || body.action === "join") {
      const name = cleanName(body.name);
      if (!name) return reply({error:"Isi nama pemain dulu."},400);
      let room: any = null;

      if (body.action === "create") {
        for (let i=0;i<6;i++) {
          const result = await client.from("exhibit_rooms").insert({
            code: makeCode(), status:"active",
            state:{security_solved:false,archive_unlocked:false,clue_found:false},
            expires_at:new Date(Date.now()+10*60*1000).toISOString()
          }).select("id,code,status,host_player_id,state,expires_at").single();
          if (!result.error) { room=result.data; break; }
          if (result.error.code !== "23505") throw result.error;
        }
        if (!room) throw new Error("Tidak bisa membuat room.");
      } else {
        const code = String(body.code ?? "").trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) return reply({error:"Kode room harus 6 karakter."},400);
        const found = await client.from("exhibit_rooms").select("*").eq("code",code).maybeSingle();
        if (found.error) throw found.error;
        room = found.data;
        if (!room || room.status !== "active") return reply({error:"Room tidak ditemukan atau sudah selesai."},404);
        if (new Date(room.expires_at).getTime() <= Date.now()) {
          await client.from("exhibit_rooms").update({status:"expired"}).eq("id",room.id);
          return reply({error:"Waktu room sudah habis."},410);
        }
        const {count,error} = await client.from("exhibit_players").select("id",{count:"exact",head:true}).eq("room_id",room.id);
        if (error) throw error;
        if ((count ?? 0) >= 8) return reply({error:"Room penuh. Maksimal 8 pemain."},400);
      }

      const playerId = crypto.randomUUID();
      const sessionToken = token();
      const insert = await client.from("exhibit_players").insert({
        id:playerId, room_id:room.id, name, token_hash:await digest(sessionToken)
      });
      if (insert.error) throw insert.error;
      if (body.action === "create") {
        const update = await client.from("exhibit_rooms").update({host_player_id:playerId}).eq("id",room.id);
        if (update.error) throw update.error;
        room.host_player_id = playerId;
      }
      return reply({
        room:{id:room.id,code:room.code,status:room.status,host_player_id:room.host_player_id,
          state:safeState(room.state ?? {}),expires_at:room.expires_at},
        player_id:playerId,session_token:sessionToken
      });
    }

    const player = await getPlayer(client,body.player_id,body.session_token);
    if (!player) return reply({error:"Sesi pemain tidak valid. Masuk ke room lagi."},403);
    const foundRoom = await client.from("exhibit_rooms").select("id,code,status,host_player_id,state,expires_at")
      .eq("id",player.room_id).single();
    if (foundRoom.error) throw foundRoom.error;
    const room = foundRoom.data;
    await client.from("exhibit_players").update({last_seen:new Date().toISOString()}).eq("id",player.id);

    if (body.action === "snapshot") {
      if (room.status === "active" && new Date(room.expires_at).getTime() <= Date.now()) {
        await client.from("exhibit_rooms").update({status:"expired"}).eq("id",room.id);
        room.status = "expired";
      }
      const playersResult = await client.from("exhibit_players")
        .select("id,name,room_key,x,y,inventory,evidence,last_seen")
        .eq("room_id",room.id).order("created_at");
      if (playersResult.error) throw playersResult.error;
      return reply({
        room:{id:room.id,code:room.code,status:room.status,host_player_id:room.host_player_id,
          state:safeState(room.state ?? {}),expires_at:room.expires_at},
        players:playersResult.data ?? [],self_id:player.id
      });
    }
    if (body.action === "leave") {
      const deletion = await client.from("exhibit_players").delete().eq("id",player.id);
      if (deletion.error) throw deletion.error;
      const remaining = await client.from("exhibit_players").select("id").eq("room_id",room.id).order("created_at");
      if (remaining.error) throw remaining.error;
      if (!remaining.data || remaining.data.length===0) {
        await client.from("exhibit_rooms").delete().eq("id",room.id);
      } else if (room.host_player_id===player.id) {
        await client.from("exhibit_rooms").update({host_player_id:remaining.data[0].id}).eq("id",room.id);
      }
      return reply({ok:true});
    }

    if (room.status !== "active") return reply({error:"Permainan sudah berakhir."},409);

    if (body.action === "move") {
      const x = Number(body.x), y = Number(body.y);
      const roomKey = String(body.room_key ?? player.room_key);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x<5 || x>95 || y<8 || y>92) return reply({error:"Posisi tidak valid."},400);
      if (roomKey !== player.room_key) return reply({error:"Gunakan pintu untuk pindah ruangan."},400);
      const update = await client.from("exhibit_players").update({x,y,last_seen:new Date().toISOString()}).eq("id",player.id);
      if (update.error) throw update.error;
      return reply({ok:true});
    }

    if (body.action === "door") {
      const target = String(body.target ?? "");
      const routes: Record<string,string[]> = {main:["security"],security:["main","archive"],archive:["security"]};
      if (!(routes[player.room_key] ?? []).includes(target)) return reply({error:"Pintu tidak terhubung."},400);
      const state = room.state as Record<string,unknown>;
      if (target==="archive" && state.archive_unlocked!==true) return reply({error:"Archive masih terkunci. Pecahkan panel Security dulu."},403);
      const spawn = target==="main" ? {x:88,y:52} :
        target==="security" && player.room_key==="main" ? {x:12,y:52} :
        target==="security" ? {x:88,y:52} : {x:12,y:52};
      const update = await client.from("exhibit_players")
        .update({room_key:target,x:spawn.x,y:spawn.y,last_seen:new Date().toISOString()}).eq("id",player.id);
      if (update.error) throw update.error;
      return reply({ok:true,room_key:target,x:spawn.x,y:spawn.y});
    }

    if (body.action === "interact") {
      const target = String(body.target ?? "");
      const state = room.state as Record<string,unknown>;
      const evidence = Array.isArray(player.evidence) ? [...player.evidence] as string[] : [];
      const inventory = Array.isArray(player.inventory) ? [...player.inventory] as string[] : [];
      const add = (list:string[],item:string) => list.includes(item) ? list : [...list,item];
      let message = "";

      if (target==="display_label") {
        if (player.room_key!=="main" || !near(player,31,43)) return reply({error:"Dekati plakat pameran dulu."},400);
        const update = await client.from("exhibit_players").update({evidence:add(evidence,"Nomor inventaris: 43")}).eq("id",player.id);
        if (update.error) throw update.error;
        message = "Petunjuk ditemukan: nomor inventaris artefak adalah 43.";
      } else if (target==="opening_hours") {
        if (player.room_key!=="main" || !near(player,69,43)) return reply({error:"Dekati papan informasi dulu."},400);
        const update = await client.from("exhibit_players").update({evidence:add(evidence,"Jam buka: 09.00")}).eq("id",player.id);
        if (update.error) throw update.error;
        message = "Petunjuk ditemukan: museum mulai buka pukul 09.00.";
      } else if (target==="security_panel") {
        if (player.room_key!=="security" || !near(player,50,44)) return reply({error:"Dekati panel akses dulu."},400);
        if (state.security_solved!==true && (!evidence.includes("Nomor inventaris: 43") || !evidence.includes("Jam buka: 09.00"))) {
          return reply({error:"Kumpulkan dua petunjuk di Main Hall sebelum mencoba panel."},400);
        }
        if (String(body.answer ?? "").trim()!=="4309") return reply({error:"Kode salah. Gabungkan nomor inventaris dan jam buka."},400);
        const [pUpdate,rUpdate] = await Promise.all([
          client.from("exhibit_players").update({inventory:add(inventory,"Keycard")}).eq("id",player.id),
          client.from("exhibit_rooms").update({state:{...state,security_solved:true,archive_unlocked:true},updated_at:new Date().toISOString()}).eq("id",room.id)
        ]);
        if (pUpdate.error) throw pUpdate.error;
        if (rUpdate.error) throw rUpdate.error;
        message = "Panel terbuka. Keycard didapat dan pintu Archive berhasil dibuka.";
      } else if (target==="archive_clue") {
        if (player.room_key!=="archive" || !near(player,50,45)) return reply({error:"Dekati meja dokumen dulu."},400);
        if (state.archive_unlocked!==true) return reply({error:"Archive masih terkunci."},403);
        const [pUpdate,rUpdate] = await Promise.all([
          client.from("exhibit_players").update({evidence:add(evidence,"Catatan pengiriman: 22.30, Dermaga Utara.")}).eq("id",player.id),
          client.from("exhibit_rooms").update({state:{...state,clue_found:true},status:"completed",updated_at:new Date().toISOString()}).eq("id",room.id)
        ]);
        if (pUpdate.error) throw pUpdate.error;
        if (rUpdate.error) throw rUpdate.error;
        message = "Clue utama ditemukan: Kompas Arunika dijadwalkan dikirim pukul 22.30 melalui Dermaga Utara.";
      } else {
        return reply({error:"Objek tidak dikenal."},400);
      }
      return reply({ok:true,message});
    }

    return reply({error:"Action tidak dikenal."},400);
  } catch (error) {
    console.error("missing-exhibit-api",error);
    return reply({error:"Server game mengalami masalah. Coba lagi sebentar."},500);
  }
});