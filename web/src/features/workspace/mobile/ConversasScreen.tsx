import type { ReactNode } from "react";
import { Icon, Menu, MenuItem, MenuRadioGroup } from "faang-ui";
import { Avatar } from "faang-ui";
import { Plus, Search, Settings2 } from "@jeff/icons";
import type { User } from "../../../shared/api";
import { MEMBER_STATUS_LABEL, type MemberStatus } from "../../../shared/ui/presence";
import { usePrefs } from "../../../shared/prefs";
import type { ChannelCategory, Principal, Room } from "../../rooms/api";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import { MobileEmpty, MobileSectionTitle, MobileWorkspaceButton } from "./mobile-ui";
import { CategoryGlyph } from "../WorkspaceGlyph";
import JeffBell from "../../../shared/ui/JeffBell";

export interface MobileTeamMember {
  key: string;
  name: string;
  meta: string;
  status: MemberStatus;
  statusText: string;
  kind: "human" | "bot";
  user: User | null;
  bot: Principal | null;
}

interface Props {
  teamName: string;
  workspaceLogo: string;
  memberCount: number;
  onOpenDrawer: () => void;
  bots: Principal[];
  me: Principal | null;
  rooms: Room[];
  categories: ChannelCategory[];
  teamMembers: MobileTeamMember[];
  unread: number;
  unreadRoomIds: Set<string>;
  userName: string;
  userFace: ReactNode;
  userStatus: MemberStatus;
  renderFace: (principal: Principal | null | undefined, size?: number) => ReactNode;
  isAdmin: boolean;
  selectedRoomId: string;
  searchQuery: string;
  onSearchQuery: (value: string) => void;
  onSelectRoom: (room: Room) => void;
  onOpenAgent: (agent: Principal) => void;
  onEditPerson: (user: User) => void;
  onEditAgent: (agent: Principal) => void;
  onCreateChannel: (categoryId?: string | null) => void;
  onCreateCategory: () => void;
  onChannelOptions: (room: Room) => void;
  onCategoryOptions: (category: ChannelCategory) => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
}

function presence(status: MemberStatus) {
  return <span className="m-presence" data-status={status} aria-hidden="true" />;
}

/** The phone's channel screen: the workspace, its channels, the team and the DMs. */
export default function ConversasScreen({
  teamName,
  workspaceLogo,
  memberCount,
  onOpenDrawer,
  bots,
  me,
  rooms,
  categories,
  teamMembers,
  unread,
  unreadRoomIds,
  userName,
  userFace,
  userStatus,
  renderFace,
  isAdmin,
  selectedRoomId,
  searchQuery,
  onSearchQuery,
  onSelectRoom,
  onOpenAgent,
  onEditPerson,
  onEditAgent,
  onCreateChannel,
  onCreateCategory,
  onChannelOptions,
  onCategoryOptions,
  onOpenSearch,
  onOpenNotifications,
  onOpenSettings,
}: Props) {
  const setUserStatus = usePrefs((state) => state.update);
  const prefs = usePrefs((state) => state.prefs);
  const openSections = {
    channels: prefs.sidebarSections?.channels !== false,
    agents: prefs.sidebarSections?.agents !== false,
    dms: prefs.sidebarSections?.dms !== false,
  };
  const openCategories = prefs.sidebarCategories ?? {};
  const query = searchQuery.trim().toLowerCase();
  const matches = (text: string) => !query || text.toLowerCase().includes(query);

  const channels = rooms.filter((room) => room.kind === "room" && matches(room.name));
  const uncategorized = channels.filter((room) => !room.categoryId);
  const categorized = categories
    .map((category) => ({ category, rooms: channels.filter((room) => room.categoryId === category.id) }))
    .filter((group) => group.rooms.length > 0 || !query);
  const dms = rooms.filter((room) => room.kind === "dm" && !room.members.some((member) => member.kind === "bot"));
  const people = teamMembers.filter((member) => matches(member.name));

  function toggleSection(section: "channels" | "agents" | "dms") {
    usePrefs.getState().update({
      sidebarSections: { ...prefs.sidebarSections, [section]: !openSections[section] },
    });
  }

  function toggleCategory(id: string) {
    usePrefs.getState().update({
      sidebarCategories: { ...openCategories, [id]: openCategories[id] === false },
    });
  }

  function channelRow(room: Room) {
    return (
      <div className="m-rowwrap" key={room.id}>
        <button
          type="button"
          className="m-row m-row--channel"
          data-active={room.id === selectedRoomId || undefined}
          data-unread={unreadRoomIds.has(room.id) || undefined}
          onClick={() => onSelectRoom(room)}
        >
          <Icon name="channel" size={18} className="m-row__glyph" />
          <span className="m-row__name">{room.name}</span>
          {unreadRoomIds.has(room.id) ? <span className="m-row__unread" aria-label="Não lida" /> : null}
          {room.visibility === "private" ? <span className="m-row__tag">privado</span> : null}
        </button>
        {isAdmin ? (
          <MobileIconButton
            icon={Settings2}
            label={`Opções de ${room.name}`}
            className="m-row__action"
            onClick={() => onChannelOptions(room)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="m-screen m-screen--conversas">
      <MobileScreenHeader
        variant="workspace"
        lead={<MobileWorkspaceButton logo={workspaceLogo} name={teamName} meta={`${memberCount} ${memberCount === 1 ? "membro" : "membros"} · ${bots.length} ${bots.length === 1 ? "agente" : "agentes"}`} onClick={onOpenDrawer} />}
        actions={
          <>
            <MobileIconButton icon={Search} label="Buscar" onClick={onOpenSearch} />
            <MobileIconButton icon={JeffBell} label="Notificações" badge={unread} onClick={onOpenNotifications} />
            <MobileIconButton icon={Settings2} label="Configurações" onClick={onOpenSettings} />
            {isAdmin ? (
              <Menu
                align="end"
                label="Criar"
                trigger={<MobileIconButton icon={Plus} label="Criar canal ou categoria" />}
              >
                <MenuItem icon="channel" onSelect={() => onCreateChannel(null)}>
                  Novo canal
                </MenuItem>
                <MenuItem icon="layers" onSelect={onCreateCategory}>
                  Nova categoria
                </MenuItem>
              </Menu>
            ) : null}
          </>
        }
      />

      <div className="m-searchline">
        <Search className="m-searchline__icon" />
        <input
          value={searchQuery}
          onChange={(event) => onSearchQuery(event.target.value)}
          placeholder="Buscar canais, agentes e pessoas"
          aria-label="Buscar canais, agentes e pessoas"
          inputMode="search"
        />
        {searchQuery ? (
          <button type="button" className="m-searchline__clear" onClick={() => onSearchQuery("")} aria-label="Limpar busca">
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>

      <div className="m-scroll m-scroll--channels">
        <MobileSectionTitle
          title="Canais"
          open={openSections.channels}
          onToggle={() => toggleSection("channels")}
          actions={
            isAdmin ? (
              <button type="button" className="m-section__add" aria-label="Criar canal" onClick={() => onCreateChannel(null)}>
                <Icon name="plus" size={14} />
              </button>
            ) : null
          }
        />
        {openSections.channels ? (
          <div className="m-section__body">
            {uncategorized.map(channelRow)}
            {categorized.map(({ category, rooms: categoryRooms }) => {
              const open = openCategories[category.id] !== false;
              return (
                <div className="m-category" key={category.id}>
                  <MobileSectionTitle
                    title={category.name}
                    icon={<CategoryGlyph category={category} size={18} />}
                    open={open}
                    onToggle={() => toggleCategory(category.id)}
                    actions={
                      isAdmin ? (
                        <>
                          <button type="button" className="m-section__add" aria-label={`Novo canal em ${category.name}`} onClick={() => onCreateChannel(category.id)}>
                            <Icon name="plus" size={14} />
                          </button>
                          <MobileIconButton
                            icon={Settings2}
                            label={`Opções de ${category.name}`}
                            className="m-row__action"
                            onClick={() => onCategoryOptions(category)}
                          />
                        </>
                      ) : null
                    }
                  />
                  {open ? <div className="m-section__body">{categoryRooms.map(channelRow)}</div> : null}
                </div>
              );
            })}
            {channels.length === 0 ? (
              <MobileEmpty title={query ? "Nenhum canal encontrado" : "Nenhum canal ainda"}>
                {query ? "Tente outro nome." : "Crie o primeiro canal do workspace."}
              </MobileEmpty>
            ) : null}
          </div>
        ) : null}

        <MobileSectionTitle
          title="Equipe"
          count={people.length}
          open={openSections.agents}
          onToggle={() => toggleSection("agents")}
        />
        {openSections.agents ? (
          <div className="m-section__body">
            {people.map((member) => (
              <div className="m-rowwrap m-teammember" key={member.key}>
                <button
                  type="button"
                  className="m-row m-row--person"
                  onClick={() => {
                    if (member.bot) onOpenAgent(member.bot);
                    else if (member.user) onEditPerson(member.user);
                  }}
                >
                  <span className="m-row__face">
                    {member.bot ? renderFace(member.bot, 32) : <Avatar name={member.name} size="md" />}
                    {presence(member.status)}
                  </span>
                  <span className="m-row__copy">
                    <span className="m-row__line">
                      <span className="m-row__name">{member.name}</span>
                      {member.kind === "bot" ? <span className="m-row__tag">agente</span> : null}
                    </span>
                    <span className="m-row__sub" data-status={member.status}>
                      <span className="m-presence-dot" data-status={member.status} aria-hidden="true" />
                      {member.statusText}
                    </span>
                  </span>
                </button>
                {isAdmin ? (
                  <MobileIconButton
                    icon={Settings2}
                    label={`Editar ${member.name}`}
                    className="m-row__action"
                    onClick={() => {
                      if (member.bot) onEditAgent(member.bot);
                      else if (member.user) onEditPerson(member.user);
                    }}
                  />
                ) : null}
              </div>
            ))}
            {people.length === 0 ? <MobileEmpty title="Ninguém na equipe ainda" /> : null}
          </div>
        ) : null}

        <MobileSectionTitle
          title="Mensagens diretas"
          open={openSections.dms}
          onToggle={() => toggleSection("dms")}
        />
        {openSections.dms ? (
          <div className="m-section__body">
            {dms.map((room) => {
              const other = room.members.find((member) => member.id !== me?.id);
              return (
                <button
                  key={room.id}
                  type="button"
                  className="m-row m-row--person"
                  data-active={room.id === selectedRoomId || undefined}
                  onClick={() => onSelectRoom(room)}
                >
                  <span className="m-row__face">{renderFace(other, 32)}</span>
                  <span className="m-row__copy">
                    <span className="m-row__name">{other?.name || room.name}</span>
                    <span className="m-row__sub">Conversa direta</span>
                  </span>
                </button>
              );
            })}
            {dms.length === 0 ? (
              <MobileEmpty title="Nenhuma conversa direta">Convide alguém para o workspace.</MobileEmpty>
            ) : null}
          </div>
        ) : null}
        <div className="m-scroll__end" />
      </div>

      <div className="m-profilebar">
        <Menu
          align="start"
          label="Seu status"
          trigger={
            <button type="button" className="m-profilebar__me" aria-label={`Seu status: ${MEMBER_STATUS_LABEL[userStatus]}`}>
              <span className="m-profilebar__face">
                {userFace}
                {presence(userStatus)}
              </span>
              <span className="m-profilebar__copy">
                <strong>{userName}</strong>
                <small data-status={userStatus}>{MEMBER_STATUS_LABEL[userStatus]}</small>
              </span>
            </button>
          }
        >
          <MenuRadioGroup
            label="Seu status"
            value={userStatus}
            onValueChange={(value) => setUserStatus({ userStatus: value as MemberStatus })}
            options={(["online", "away", "busy", "offline"] as MemberStatus[]).map((value) => ({
              value,
              label: MEMBER_STATUS_LABEL[value],
              leading: <span className="m-status-mark" data-status={value} />,
            }))}
          />
        </Menu>
      </div>
    </div>
  );
}
