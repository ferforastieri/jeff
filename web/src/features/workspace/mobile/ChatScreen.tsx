import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Chip,
  Composer,
  Dialog,
  DialogBody,
  GroupHeading,
  Icon,
  ListRow,
  Menu,
  MenuCheckboxItem,
  Message,
  MessageLookContext,
  MessageText,
  SearchField,
} from "faang-ui";
import { Info, Search, SlidersHorizontal } from "@jeff/icons";
import type { AIModel, User } from "../../../shared/api";
import type { Principal, Room, RoomMessage } from "../../rooms/api";
import AgentComposerControls from "../AgentComposerControls";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import { formatTime } from "../../../shared/time";
import { basename } from "../../../shared/lib";

const EMOJI_LABELS = {
  dialog: "Emojis",
  search: "Buscar emoji",
  noResults: "Nenhum emoji encontrado",
  recent: "Usados recentemente",
  results: "Resultados",
  categories: {
    smileys: "Carinhas",
    people: "Pessoas",
    nature: "Natureza",
    food: "Comida",
    activities: "Atividades",
    travel: "Viagem",
    objects: "Objetos",
    symbols: "Símbolos",
  },
  button: "Emoji",
};

interface Props {
  room: Room;
  agent: Principal | null;
  me: Principal | null;
  people: Map<string, Principal>;
  messages: RoomMessage[];
  title: string;
  subtitle: string;
  draft: string;
  models: AIModel[];
  welcome: ReactNode;
  onBack: () => void;
  onDraft: (value: string) => void;
  onSend: (text: string) => void;
  onConnectAI: () => void;
  onAgentUpdated: (agent: Principal) => void;
  onOpenChannelAgents: () => void;
  onOpenChannelRepos: () => void;
  onOpenAgent: (agent: Principal) => void;
  onOpenMember: (user: User) => void;
  renderFace: (principal: Principal | null | undefined, size?: number) => ReactNode;
}

/** A room or DM as the phone's chat screen: flat messages, Discord's shape, and one composer. */
export default function ChatScreen({
  room,
  agent,
  me,
  people,
  messages,
  title,
  subtitle,
  draft,
  models,
  welcome,
  onBack,
  onDraft,
  onSend,
  onConnectAI,
  onAgentUpdated,
  onOpenChannelAgents,
  onOpenChannelRepos,
  onOpenAgent,
  onOpenMember,
  renderFace,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [linkOnly, setLinkOnly] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return messages
      .filter((message) => message.text.trim())
      .filter((message) => !linkOnly || /https?:\/\/|!\[[^\]]*\]\(|\[[^\]]+\]\(/.test(message.text))
      .filter((message) => !needle || message.text.toLowerCase().includes(needle));
  }, [linkOnly, messages, query]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, room.id]);

  const channelAgents = room.members.filter((member) => member.kind === "bot");
  const other = room.kind === "dm" ? room.members.find((member) => member.id !== me?.id) ?? agent : null;

  return (
    <div className="m-screen m-screen--chat">
      <MobileScreenHeader
        onBack={onBack}
        backLabel="Voltar às conversas"
        lead={
          <span className="m-chathead__face">
            {room.kind === "room" ? (
              <span className="m-chathead__channel"><Icon name="channel" size={18} /></span>
            ) : (
              renderFace(other, 32)
            )}
          </span>
        }
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <MobileIconButton icon={Search} label="Buscar nesta conversa" active={searchOpen} onClick={() => setSearchOpen((value) => !value)} />
            <MobileIconButton icon={Info} label="Detalhes da conversa" onClick={() => setDetailsOpen(true)} />
          </>
        }
      >
        {searchOpen ? (
          <div className="m-chatsearch">
            <SearchField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nesta conversa"
              size="sm"
              onClear={() => setQuery("")}
              clearLabel="Limpar busca"
            />
            <Menu
              align="end"
              label="Filtros"
              trigger={<MobileIconButton icon={SlidersHorizontal} label="Filtros da conversa" />}
            >
              <MenuCheckboxItem
                checked={linkOnly}
                onCheckedChange={setLinkOnly}
                icon="link"
                description="tem: link, arquivo, imagem ou cartão"
              >
                Com link, arquivo, imagem ou cartão
              </MenuCheckboxItem>
            </Menu>
          </div>
        ) : null}
      </MobileScreenHeader>

      <div className="m-chatscroll" ref={scroller}>
        <MessageLookContext.Provider value={{ style: "left", tone: "strong", mine: "var(--agent)", names: true, faces: true }}>
        <div className="m-chatlist">
          {messages.length === 0 && agent ? (
            <Message
              className="m-arrival"
              avatar={renderFace(agent, 28)}
              author={agent.name}
              time={formatTime(Date.now())}
              agent
            >
              <MessageText>
                Oi, eu sou {agent.name}. Monto o time com você. Crio os agentes, conecto os apps e
                convido as pessoas. Nada muda sem você pedir, e eu faço só o que você pode fazer.
              </MessageText>
            </Message>
          ) : null}
          {messages.length === 0 ? welcome : null}
          {visible.map((message, index, list) => {
            const author = people.get(message.author.id) ?? {
              id: message.author.id,
              name: message.author.name,
              handle: message.author.handle,
              kind: message.author.kind,
              avatar: {},
            } as Principal;
            const previous = list[index - 1];
            return (
              <Message
                key={message.id}
                avatar={renderFace(author, 28)}
                author={message.author.name}
                time={formatTime(message.createdAt)}
                own={message.author.id === me?.id}
                agent={message.author.kind === "bot"}
                grouped={previous?.author.id === message.author.id}
              >
                <MessageText>{message.text}</MessageText>
              </Message>
            );
          })}
          {visible.length === 0 && query ? (
            <p className="m-chatempty">Nenhuma mensagem encontrada.</p>
          ) : null}
          <div ref={end} />
        </div>
        </MessageLookContext.Provider>
      </div>

      <footer className="m-composer">
        {agent ? (
          <div className="m-composer-controls">
            <AgentComposerControls
              agent={agent}
              models={models}
              onConnect={onConnectAI}
              onUpdated={onAgentUpdated}
            />
          </div>
        ) : null}
        <Composer
          value={draft}
          onChange={onDraft}
          onSend={onSend}
          label={`Mensagem para ${title}`}
          placeholder={`Mensagem para ${title} · nada muda sem você`}
          sendLabel="Enviar"
          attachLabel="Anexar"
          emoji={EMOJI_LABELS}
        />
      </footer>

      <Dialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={title}
        description={subtitle}
        closeLabel="Fechar"
      >
        <DialogBody className="m-details">
          <div className="m-details__hero">
            {room.kind === "room" ? (
              <span className="m-details__channel"><Icon name="channel" size={20} /></span>
            ) : (
              renderFace(other, 48)
            )}
            <div>
              <strong>{room.kind === "room" ? `# ${room.name}` : other?.name || title}</strong>
              <p>{room.kind === "room" ? room.title || `${room.members.length} membros` : "Conversa direta"}</p>
            </div>
          </div>

          {room.kind === "room" ? (
            <>
              <section className="m-details__section">
                <GroupHeading title="Agentes do canal" />
                {channelAgents.length > 0 ? (
                  <div className="m-details__chips">
                    {channelAgents.map((member) => (
                      <Chip key={member.id} lead={renderFace(member, 18)}>{member.name}</Chip>
                    ))}
                  </div>
                ) : (
                  <p className="m-muted">Nenhum agente neste canal.</p>
                )}
                <Button variant="default" size="sm" icon="members" onClick={() => { setDetailsOpen(false); onOpenChannelAgents(); }}>
                  Escolher agentes
                </Button>
              </section>

              <section className="m-details__section">
                <GroupHeading title="Repos do canal" />
                {room.repos.length > 0 ? (
                  <div className="m-details__chips">
                    {room.repos.map((path) => (
                      <Chip key={path}>{basename(path)}</Chip>
                    ))}
                  </div>
                ) : (
                  <p className="m-muted">Nenhum repo escolhido.</p>
                )}
                <Button variant="default" size="sm" icon="repo" onClick={() => { setDetailsOpen(false); onOpenChannelRepos(); }}>
                  Escolher repos
                </Button>
              </section>
            </>
          ) : null}

          <section className="m-details__section">
            <GroupHeading title="Membros" />
            <div className="m-details__members">
              {room.members.map((member) => (
                <ListRow
                  key={member.id}
                  lead={renderFace(member, 28)}
                  title={member.name}
                  meta={member.kind === "bot" ? "agente" : "pessoa"}
                  onClick={() => {
                    if (member.kind === "bot") onOpenAgent(member);
                    else if (member.userId) onOpenMember({ id: member.userId, username: member.handle } as User);
                  }}
                />
              ))}
            </div>
          </section>
        </DialogBody>
      </Dialog>
    </div>
  );
}
