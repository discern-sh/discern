/** Legacy effect fixtures choose semantic actions; live navigation has separate package-runtime tests. */
import { updateTerminalApplication, renderTerminalApplication, type TerminalApplicationState, type TerminalApplicationContext } from "discern-design-system/cli/interactive";
import { FakeTerminalIO } from "discern-design-system/cli/interactive/testing";
import type { TerminalApplicationOptions, SelectionRequestOptions } from "../../src/lib/terminal_interaction.ts";
import type { DeskChoice } from "../../src/engine/desk/application_view.ts";
import { DESK_ACTIONS, type DeskAction } from "../../src/engine/desk/model.ts";
import { DESK_ROUTES, deskUnlandedRoute } from "../../src/engine/desk/contracts.ts";
import type { StatusData } from "../../src/shared/result_schemas.ts";
const tokens: Record<string,string> = {back:DESK_ROUTES.back,quit:DESK_ROUTES.quit,retry:DESK_ROUTES.refresh,start:DESK_ROUTES.startTask,scripts:DESK_ROUTES.runProjectScript,main:DESK_ROUTES.mainCheckout,recent:DESK_ROUTES.recentCompleted,docs:DESK_ROUTES.readDocs};
/** Exercise foreground effect code with old semantic fixtures without claiming input/painting coverage. */
export async function scriptedDeskEffects(options:TerminalApplicationOptions<DeskChoice>, select:(options:SelectionRequestOptions<string>)=>string|Promise<string>, data:()=>StatusData, output:(frame:string)=>void):Promise<void> {
  let state: TerminalApplicationState<DeskChoice>=updateTerminalApplication(options.view);
  let wake: (()=>void)|undefined;
  let fault:unknown;
  let changed=true;
  const context:TerminalApplicationContext<DeskChoice>={get state(){return state;},update:view=>{state=updateTerminalApplication(view,state);changed=true;wake?.();},fail:error=>{fault=error;wake?.();}};
  const cleanup=options.start?.(context);
  const wait=async():Promise<void>=>{await new Promise<void>(resolve=>{wake=resolve;});wake=undefined;};
  const io=new FakeTerminalIO([],{rows:30,columns:120});
  const token=(choice:DeskChoice):string=>choice.kind === "action" ? choice.action : choice.kind === "task" ? data().fleet?.find(row=>(row.id ?? (row.branch || row.path)) === choice.id)?.path ?? choice.id : choice.route === "unlanded" ? deskUnlandedRoute(choice.branch ?? "") : tokens[choice.route] ?? choice.route;
  try {
    while(state.view.title.includes("Loading")) await wait();
    for(let i=0;i<100;i++) {
      if(fault) throw fault;
      if(changed){output(renderTerminalApplication(state,io.size(),io.capabilities()).frame);changed=false;}
      const entries=state.view.regions.flatMap(region=>region.kind === "choices" ? region.entries.filter(entry=>entry.kind !== "group-heading") : []);
      const task=entries.find(entry=>entry.value.kind === "action")?.value;
      const selected=await select({message:task ? "Choose an action" : data().fleet?.some(row=>!row.is_main) ? "Choose a task or desk command" : "Choose a desk command",search:true,options:entries.map(entry=>({name:entry.label,value:token(entry.value)}))});
      let value=entries.find(entry=>token(entry.value) === selected)?.value;
      if(value === undefined && task?.kind === "action" && DESK_ACTIONS.includes(selected as DeskAction)) value={...task,action:selected as DeskAction};
      if(value === undefined && selected === DESK_ROUTES.quit) return;
      if(value === undefined && selected === DESK_ROUTES.back) value={kind:"route",route:"back"};
      if(value === undefined) throw new Error(`Effect fixture cannot choose ${JSON.stringify(selected)}`);
      const result=options.onAction?.({regionId:state.focusedRegionId,itemId:selected,value},context);
      if(result?.kind === "exit") return;
      if(result?.kind === "foreground") await result.run();
      if(value.kind === "route" && value.route === "retry") {while(state.view.title.includes("Refreshing") || state.view.title.includes("Loading")) await wait();}
    }
    throw new Error("Effect fixture did not finish");
  } finally {cleanup?.();}
}
