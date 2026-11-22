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
        .upsert({ room_id: room.id, phase: "lobby", last_night_summary: null });
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
            .select("phase,last_night_summary")
            .eq("room_id", player.room_id)
            .single(),
        ]);

      if (roomError) throw roomError;
      if (playersError) throw playersError;
      if (stateError) throw stateError;

      let night_progress = null;
      let my_night_action = null;
      if (state.phase === "night") {
        const [{ data: roleRows, error: roleError }, { data: actionRows, error: actionError }] =
          await Promise.all([
            db.from("werewolf_roles")
              .select("player_id,role")
              .eq("room_id", player.room_id),
            db.from("night_actions")
              .select("player_id,action_type,target_player_id")
              .eq("room_id", player.room_id)
              .eq("night", room.round),
          ]);
        if (roleError) throw roleError;
        if (actionError) throw actionError;

        const livingIds = new Set((players ?? []).filter((p: any) => p.is_alive).map((p: any) => p.id));
        const requiredActors = (roleRows ?? []).filter((r: any) =>
          livingIds.has(r.player_id) && ["WEREWOLF", "SEER", "DOCTOR"].includes(r.role)
        );
        const submittedIds = new Set((actionRows ?? []).map((a: any) => a.player_id));
        night_progress = {
          submitted: requiredActors.filter((r: any) => submittedIds.has(r.player_id)).length,
          required: requiredActors.length,
        };
        my_night_action = (actionRows ?? []).find((a: any) => a.player_id === player.id) ?? null;
      }

      return json({
        room,
        players: players ?? [],
        phase: state.phase,
        last_night_summary: state.last_night_summary,
        night_progress,
        my_night_action,
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
        .upsert({ room_id: roomId, phase: "night", resolution_version: 1, last_night_summary: null });
      if (stateError) throw stateError;

      return json({ started: true });
    }

    if (body.action === "role") {
      const player = await authenticate(db, body.player_id, body.session_token);
      if (!player) return json({ error: "Invalid session" }, 403);

      const [{ data: role, error: roleError }, { data: state, error: stateError }, { data: room, error: roomError }] =
        await Promise.all([
          db.from("werewolf_roles").select("role").eq("player_id", player.id).maybeSingle(),
          db.from("game_states").select("phase").eq("room_id", player.room_id).single(),
          db.from("rooms").select("round").eq("id", player.room_id).single(),
        ]);
      if (roleError) throw roleError;
      if (stateError) throw stateError;
      if (roomError) throw roomError;
      if (!role) return json({ error: "Role not assigned yet" }, 404);

      let allies: { id: string; name: string }[] = [];
      let seer_result: { player_id: string; player_name: string; role: string } | null = null;

      if (role.role === "WEREWOLF") {
        const { data: wolves, error: wolvesError } = await db.from("werewolf_roles")
          .select("player_id")
          .eq("room_id", player.room_id)
          .eq("role", "WEREWOLF");
        if (wolvesError) throw wolvesError;
        const wolfIds = (wolves ?? []).map((w: any) => w.player_id).filter((id: string) => id !== player.id);
        if (wolfIds.length) {
          const { data: wolfPlayers, error: namesError } = await db.from("players")
            .select("id,name")
            .in("id", wolfIds)
            .eq("is_alive", true);
          if (namesError) throw namesError;
          allies = (wolfPlayers ?? []).map((p: any) => ({ id: p.id, name: p.name }));
        }
      }

      if (role.role === "SEER" && ["day", "game_over"].includes(state.phase)) {
        const { data: checked, error: checkedError } = await db.from("night_actions")
          .select("target_player_id")
          .eq("room_id", player.room_id)
          .eq("player_id", player.id)
          .eq("night", room.round)
          .eq("action_type", "SEER_CHECK")
          .maybeSingle();
        if (checkedError) throw checkedError;
        if (checked?.target_player_id) {
          const [{ data: target, error: targetError }, { data: targetRole, error: targetRoleError }] =
            await Promise.all([
              db.from("players").select("id,name").eq("id", checked.target_player_id).single(),
              db.from("werewolf_roles").select("role").eq("player_id", checked.target_player_id).single(),
            ]);
          if (targetError) throw targetError;
          if (targetRoleError) throw targetRoleError;
          seer_result = {
            player_id: target.id,
            player_name: target.name,
            role: targetRole.role,
          };
        }
      }

      return json({ role: role.role, allies, seer_result });
    }

    if (body.action === "night_action") {
      const player = await authenticate(db, body.player_id, body.session_token);
      if (!player) return json({ error: "Invalid session" }, 403);
      if (!player.is_alive) return json({ error: "Dead players cannot take night actions" }, 403);
      if (typeof body.target_player_id !== "string") {
        return json({ error: "Choose a valid target" }, 400);
      }

      const [{ data: room, error: roomError }, { data: state, error: stateError }, { data: role, error: roleError }] =
        await Promise.all([
          db.from("rooms").select("id,status,round").eq("id", player.room_id).single(),
          db.from("game_states").select("phase").eq("room_id", player.room_id).single(),
          db.from("werewolf_roles").select("role").eq("player_id", player.id).maybeSingle(),
        ]);
      if (roomError) throw roomError;
      if (stateError) throw stateError;
      if (roleError) throw roleError;
      if (room.status !== "active" || state.phase !== "night") {
        return json({ error: "Night actions are closed" }, 409);
      }
      if (!role) return json({ error: "Role not assigned" }, 400);

      let actionType = "";
      if (role.role === "WEREWOLF") actionType = "WOLF_KILL";
      if (role.role === "SEER") actionType = "SEER_CHECK";
      if (role.role === "DOCTOR") actionType = "DOCTOR_PROTECT";
      if (!actionType) return json({ error: "Your role has no night action" }, 403);

      const { data: target, error: targetError } = await db.from("players")
        .select("id,is_alive")
        .eq("id", body.target_player_id)
        .eq("room_id", player.room_id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || !target.is_alive) return json({ error: "Target must be alive in this room" }, 400);
      if (role.role === "SEER" && target.id === player.id) {
        return json({ error: "Seer cannot check themselves" }, 400);
      }

      if (role.role === "WEREWOLF") {
        const { data: targetRole, error: targetRoleError } = await db.from("werewolf_roles")
          .select("role")
          .eq("player_id", target.id)
          .maybeSingle();
        if (targetRoleError) throw targetRoleError;
        if (targetRole?.role === "WEREWOLF") return json({ error: "Werewolves cannot target their own team" }, 400);
      }

      if (role.role === "DOCTOR" && room.round > 1) {
        const { data: previous, error: previousError } = await db.from("night_actions")
          .select("target_player_id")
          .eq("room_id", player.room_id)
          .eq("player_id", player.id)
          .eq("night", room.round - 1)
          .eq("action_type", "DOCTOR_PROTECT")
          .maybeSingle();
        if (previousError) throw previousError;
        if (previous?.target_player_id === target.id) {
          return json({ error: "Doctor must protect a different player than last night" }, 400);
        }
      }

      const { data: saved, error: saveError } = await db.from("night_actions")
        .upsert({
          room_id: player.room_id,
          player_id: player.id,
          night: room.round,
          action_type: actionType,
          target_player_id: target.id,
        }, { onConflict: "room_id,player_id,night" })
        .select("action_type,target_player_id")
        .single();
      if (saveError) throw saveError;

      return json({ submitted: true, action: saved });
    }

    if (body.action === "resolve_night") {
      const player = await authenticate(db, body.player_id, body.session_token);
      if (!player) return json({ error: "Invalid session" }, 403);

      const { data: room, error: roomError } = await db.from("rooms")
        .select("id,status,round,host_player_id")
        .eq("id", player.room_id)
        .single();
      if (roomError) throw roomError;
      if (room.status !== "active" || room.host_player_id !== player.id) {
        return json({ error: "Only the host can resolve an active night" }, 403);
      }

      const { data: claimed, error: claimError } = await db.from("game_states")
        .update({ phase: "resolution", updated_at: new Date().toISOString() })
        .eq("room_id", player.room_id)
        .eq("phase", "night")
        .select("resolution_version")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return json({ error: "Night is already being resolved or has ended" }, 409);

      try {
        const [{ data: livingPlayers, error: livingError }, { data: allPlayers, error: allPlayersError }, { data: roleRows, error: rolesError }, { data: actionRows, error: actionsError }] =
          await Promise.all([
            db.from("players").select("id,name").eq("room_id", player.room_id).eq("is_alive", true),
            db.from("players").select("id,name,is_alive").eq("room_id", player.room_id),
            db.from("werewolf_roles").select("player_id,role").eq("room_id", player.room_id),
            db.from("night_actions")
              .select("player_id,action_type,target_player_id")
              .eq("room_id", player.room_id)
              .eq("night", room.round),
          ]);
        if (livingError) throw livingError;
        if (allPlayersError) throw allPlayersError;
        if (rolesError) throw rolesError;
        if (actionsError) throw actionsError;

        const livingIds = new Set((livingPlayers ?? []).map((p: any) => p.id));
        const roleById = new Map((roleRows ?? []).map((r: any) => [r.player_id, r.role]));
        const requiredActors = (roleRows ?? []).filter((r: any) =>
          livingIds.has(r.player_id) && ["WEREWOLF", "SEER", "DOCTOR"].includes(r.role)
        );
        const actionsByPlayer = new Map((actionRows ?? []).map((a: any) => [a.player_id, a]));
        const incomplete = requiredActors.some((r: any) => {
          const action: any = actionsByPlayer.get(r.player_id);
          const expected = r.role === "WEREWOLF" ? "WOLF_KILL"
            : r.role === "SEER" ? "SEER_CHECK" : "DOCTOR_PROTECT";
          return !action || action.action_type !== expected || !action.target_player_id;
        });

        if (incomplete) {
          await db.from("game_states")
            .update({ phase: "night", updated_at: new Date().toISOString() })
            .eq("room_id", player.room_id)
            .eq("phase", "resolution");
          return json({ error: "Wait until every living night role has submitted an action" }, 409);
        }

        const wolfVotes = new Map<string, number>();
        for (const action of (actionRows ?? []) as any[]) {
          if (action.action_type !== "WOLF_KILL" || !livingIds.has(action.player_id)) continue;
          if (!livingIds.has(action.target_player_id) || roleById.get(action.player_id) !== "WEREWOLF") continue;
          if (roleById.get(action.target_player_id) === "WEREWOLF") continue;
          wolfVotes.set(action.target_player_id, (wolfVotes.get(action.target_player_id) ?? 0) + 1);
        }

        let attackedId: string | null = null;
        if (wolfVotes.size) {
          const highest = Math.max(...wolfVotes.values());
          const leaders = [...wolfVotes.entries()].filter(([, count]) => count === highest);
          if (leaders.length === 1) attackedId = leaders[0][0];
        }

        const doctor = requiredActors.find((r: any) => r.role === "DOCTOR");
        const doctorAction: any = doctor ? actionsByPlayer.get(doctor.player_id) : null;
        const protectedId = doctorAction?.target_player_id ?? null;
        const victimId = attackedId && attackedId !== protectedId ? attackedId : null;

        let victimName: string | null = null;
        if (victimId) {
          victimName = (livingPlayers ?? []).find((p: any) => p.id === victimId)?.name ?? null;
          const { error: deathError } = await db.from("players")
            .update({ is_alive: false, hp: 0 })
            .eq("id", victimId)
            .eq("room_id", player.room_id)
            .eq("is_alive", true);
          if (deathError) throw deathError;
        }

        const aliveAfter = (allPlayers ?? []).filter((p: any) => p.is_alive && p.id !== victimId);
        const wolvesAlive = aliveAfter.filter((p: any) => roleById.get(p.id) === "WEREWOLF").length;
        const othersAlive = aliveAfter.length - wolvesAlive;
        let winner: "WEREWOLVES" | "VILLAGERS" | null = null;
        if (wolvesAlive === 0) winner = "VILLAGERS";
        else if (wolvesAlive >= othersAlive) winner = "WEREWOLVES";

        let summary = victimName
          ? victimName + " tidak selamat dari malam ini."
          : "Tidak ada korban malam ini.";
        if (winner === "WEREWOLVES") summary += " Tim Werewolf menang!";
        if (winner === "VILLAGERS") summary += " Tim Villager menang!";

        const nextPhase = winner ? "game_over" : "day";
        const { data: updatedState, error: stateUpdateError } = await db.from("game_states")
          .update({
            phase: nextPhase,
            last_night_summary: summary,
            resolution_version: (claimed.resolution_version ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("room_id", player.room_id)
          .eq("phase", "resolution")
          .select("room_id")
          .maybeSingle();
        if (stateUpdateError) throw stateUpdateError;
        if (!updatedState) throw new Error("Night resolution lost its lock");

        if (winner) {
          const { error: finishError } = await db.from("rooms")
            .update({ status: "finished" })
            .eq("id", player.room_id)
            .eq("status", "active");
          if (finishError) throw finishError;
        }

        return json({ resolved: true, summary, winner, phase: nextPhase });
      } catch (error) {
        await db.from("game_states")
          .update({ phase: "night", updated_at: new Date().toISOString() })
          .eq("room_id", player.room_id)
          .eq("phase", "resolution");
        throw error;
      }
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

      const [{ data: room, error: roomError }, { data: state, error: stateError }] = await Promise.all([
        db.from("rooms").select("status,round").eq("id", player.room_id).single(),
        db.from("game_states").select("phase").eq("room_id", player.room_id).single(),
      ]);
      if (roomError) throw roomError;
      if (stateError) throw stateError;
      if (room.status === "finished") return json({ error: "Room is finished" }, 400);
      if (room.status === "active" && !player.is_alive) {
        return json({ error: "Dead players cannot send village messages" }, 403);
      }
      if (room.status === "active" && !["day", "voting"].includes(state.phase)) {
        return json({ error: "Village chat is closed at night" }, 403);
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
