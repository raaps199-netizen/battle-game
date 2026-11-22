import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const secret = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function token() {
  return crypto.randomUUID() + "." + crypto.randomUUID();
}

function randomInt(max: number) {
  const ceiling = Math.floor(0x100000000 / max) * max;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= ceiling);
  return value[0] % max;
}

function shuffle<T>(values: T[]) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function roleSet(n: number) {
  const wolves = Math.max(1, Math.floor(n / 4));
  const roles: string[] = Array(wolves).fill("WEREWOLF");
  roles.push("SEER", "DOCTOR");
  if (n >= 12) roles.push("HUNTER");
  while (roles.length < n) roles.push("VILLAGER");
  return shuffle(roles);
}

function cleanName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
}

async function authenticate(db: ReturnType<typeof secret>, playerId: unknown, sessionToken: unknown) {
  if (typeof playerId !== "string" || typeof sessionToken !== "string" || sessionToken.length < 20) {
    return null;
  }

  const tokenHash = await hash(sessionToken);
  const { data: session } = await db
    .from("player_sessions")
    .select("player_id")
    .eq("player_id", playerId)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session) return null;

  const { data: player } = await db
    .from("players")
    .select("id,room_id,name,is_alive,created_at")
    .eq("id", playerId)
    .maybeSingle();

  return player ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const db = secret();

    if (body.action === "create") {
      const name = cleanName(body.name);
      if (!name) return json({ error: "Name required" }, 400);

      const player_id = crypto.randomUUID();
      const session_token = token();

      let room: any = null;
      let roomError: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
        const result = await db
          .from("rooms")
          .insert({ code: roomCode, status: "lobby", round: 1 })
          .select("id,code,status,round,host_player_id")
          .single();
        if (!result.error) {
          room = result.data;
          break;
        }
        roomError = result.error;
        if (result.error.code !== "23505") break;
      }
      if (!room) throw roomError ?? new Error("Room creation failed");

      const { error: playerError } = await db
        .from("players")
        .insert({ id: player_id, room_id: room.id, name, is_alive: true });
      if (playerError) throw playerError;

      const { error: hostError } = await db.from("rooms")
        .update({ host_player_id: player_id })
        .eq("id", room.id);
      if (hostError) throw hostError;

      const { error: stateError } = await db.from("game_states")
        .upsert({ room_id: room.id, phase: "lobby" });
      if (stateError) throw stateError;

      const { error: sessionError } = await db.from("player_sessions")
        .insert({ player_id, token_hash: await hash(session_token) });
      if (sessionError) throw sessionError;

      room.host_player_id = player_id;
      return json({ room, player_id, session_token });
    }

    if (body.action === "join") {
      const name = cleanName(body.name);
      const code = String(body.code ?? "").trim().toUpperCase();
      if (!name || !/^[A-Z0-9]{6}$/.test(code)) {
        return json({ error: "Name and valid room code required" }, 400);
      }

      const { data: room } = await db.from("rooms")
        .select("id,code,status,round,host_player_id")
        .eq("code", code)
        .maybeSingle();
      if (!room) return json({ error: "Room not found" }, 404);
      if (room.status !== "lobby") return json({ error: "Game already started" }, 400);

      const { count, error: countError } = await db.from("players")
        .select("id", { count: "exact", head: true })
        .eq("room_id", room.id);
      if (countError) throw countError;
      if ((count ?? 0) >= 20) return json({ error: "Room is full" }, 400);

      const player_id = crypto.randomUUID();
      const session_token = token();
      const { error: playerError } = await db.from("players")
        .insert({ id: player_id, room_id: room.id, name, is_alive: true });
      if (playerError) throw playerError;

      const { error: sessionError } = await db.from("player_sessions")
        .insert({ player_id, token_hash: await hash(session_token) });
      if (sessionError) {
        await db.from("players").delete().eq("id", player_id);
        throw sessionError;
      }

      return json({ room, player_id, session_token });
    }

    if (body.action === "snapshot") {
      const player = await authenticate(db, body.player_id, body.session_token);
      if (!player) return json({ error: "Invalid session" }, 403);
      if (body.room_id && body.room_id !== player.room_id) {
        return json({ error: "Player is not in this room" }, 403);
      }

      const [{ data: room, error: roomError }, { data: players, error: playersError }, { data: state, error: stateError }] =
        await Promise.all([
          db.from("rooms")
            .select("id,code,status,round,host_player_id")
            .eq("id", player.room_id)
            .single(),
          db.from("players")
            .select("id,name,is_alive,created_at")
            .eq("room_id", player.room_id)
            .order("created_at"),
          db.from("game_states")
            .select("phase")
            .eq("room_id", player.room_id)
            .single(),
        ]);

      if (roomError) throw roomError;
      if (playersError) throw playersError;
      if (stateError) throw stateError;

      return json({
        room,
        players: players ?? [],
        phase: state?.phase ?? "lobby",
      });
    }

    if (body.action === "start") {
      const player = await authenticate(db, body.player_id, body.session_token);
      if (!player) return json({ error: "Invalid session" }, 403);

      const roomId = player.room_id;
      const { data: room } = await db.from("rooms")
        .select("id,status,host_player_id")
        .eq("id", roomId)
        .single();

      if (!room || room.host_player_id !== player.id || room.status !== "lobby") {
        return json({ error: "Only the host can start this lobby" }, 403);
      }

      const { data: players, error: playersError } = await db.from("players")
        .select("id")
        .eq("room_id", roomId)
        .order("created_at");
      if (playersError) throw playersError;
      if (!players || players.length < 3 || players.length > 20) {
        return json({ error: "Werewolf needs 3-20 players" }, 400);
      }

      const { error: clearError } = await db.from("werewolf_roles").delete().eq("room_id", roomId);
      if (clearError) throw clearError;

      const assigned = roleSet(players.length);
      const roleRows = players.map((p, i) => ({
        player_id: p.id,
        room_id: roomId,
        role: assigned[i],
      }));
      const { error: roleError } = await db.from("werewolf_roles").insert(roleRows);
      if (roleError) throw roleError;

      const { error: playerResetError } = await db.from("players")
        .update({ is_alive: true, hp: 1 })
        .eq("room_id", roomId);
      if (playerResetError) throw playerResetError;

      const { error: roomUpdateError } = await db.from("rooms")
        .update({ status: "active", round: 1 })
        .eq("id", roomId)
        .eq("status", "lobby");
      if (roomUpdateError) throw roomUpdateError;

      const { error: stateError } = await db.from("game_states")
        .upsert({ room_id: roomId, phase: "night", resolution_version: 1 });
      if (stateError) throw stateError;

      return json({ started: true });
    }

    if (body.action === "role") {
      const player = await authenticate(db, body.player_id, body.session_token);
      if (!player) return json({ error: "Invalid session" }, 403);

      const { data: role, error } = await db.from("werewolf_roles")
        .select("role")
        .eq("player_id", player.id)
        .maybeSingle();
      if (error) throw error;
      if (!role) return json({ error: "Role not assigned yet" }, 404);
      return json({ role: role.role });
    }

    if (body.action === "chat_send") {
      const player = await authenticate(db, body.player_id, body.session_token);
      if (!player) return json({ error: "Invalid session" }, 403);

      const message = String(body.message ?? "").trim();
      if (!message || message.length > 500) {
        return json({ error: "Message must contain 1-500 characters" }, 400);
      }
      if (body.channel !== undefined && body.channel !== "general") {
        return json({ error: "Unsupported chat channel" }, 400);
      }

      const { data: room, error: roomError } = await db.from("rooms")
        .select("status,round")
        .eq("id", player.room_id)
        .single();
      if (roomError) throw roomError;
      if (room.status === "finished") return json({ error: "Room is finished" }, 400);
      if (room.status === "active" && !player.is_alive) {
        return json({ error: "Dead players cannot send village messages" }, 403);
      }

      const { data: saved, error } = await db.from("chat_messages")
        .insert({
          room_id: player.room_id,
          player_id: player.id,
          channel: "general",
          body: message,
          day: room.round,
        })
        .select("id,body,player_id,created_at")
        .single();
      if (error) throw error;
      return json({ message: saved });
    }

    if (body.action === "leave") {
      const player = await authenticate(db, body.player_id, body.session_token);
      if (!player) return json({ error: "Invalid session" }, 403);

      const { data: room, error: roomError } = await db.from("rooms")
        .select("id,status,host_player_id")
        .eq("id", player.room_id)
        .single();
      if (roomError) throw roomError;
      if (room.status !== "lobby") return json({ error: "You cannot leave during an active game" }, 400);

      const { error: sessionError } = await db.from("player_sessions")
        .delete()
        .eq("player_id", player.id);
      if (sessionError) throw sessionError;

      const { error: playerError } = await db.from("players")
        .delete()
        .eq("id", player.id);
      if (playerError) throw playerError;

      if (room.host_player_id === player.id) {
        const { data: nextPlayers, error: nextError } = await db.from("players")
          .select("id")
          .eq("room_id", player.room_id)
          .order("created_at")
          .limit(1);
        if (nextError) throw nextError;

        if (nextPlayers?.length) {
          const { error } = await db.from("rooms")
            .update({ host_player_id: nextPlayers[0].id })
            .eq("id", player.room_id);
          if (error) throw error;
        } else {
          const { error } = await db.from("rooms")
            .update({ status: "finished", host_player_id: null })
            .eq("id", player.room_id);
          if (error) throw error;
        }
      }

      return json({ left: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Server error" }, 500);
  }
});
