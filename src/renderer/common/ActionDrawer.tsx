import React, { useRef, useState } from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import { Toolbar, Stack, Typography, Link } from "@mui/material";
import { OutputListItems } from "../features/output/OutputListItems";
import { InputListItems } from "../features/input/InputListItems";
import { BookmarkListItems } from "../features/bookmarks/BookmarkListItems";
import { Settings } from "../features/settings/Settings";

import { RootState } from "../app/store";
import { useSelector, useDispatch } from "react-redux";
import { addTab, selectTab } from "../features/tabs/tabsSlice";
import { getBounds } from "../features/tabs/getBounds";
import { Button } from "@mui/material";

import icon from "../../assets/icon.svg";
import { useHideScrollbar } from "./useHideScrollbar";
import { showWindowControls } from "./showWindowControls";

export const drawerWidth = 240;

export function ActionDrawer() {
  const dispatch = useDispatch();
  const openCampaign = async () => {
    try {
      const url = await window.kenku.campaignURL();
      const b = getBounds();
      const id = await window.kenku.createBrowserView(url, b.x, b.y, b.width, b.height);
      dispatch(addTab({id, url, title: "Campanha", icon: "", playingMedia: 0, muted: false}));
      dispatch(selectTab(id));
    } catch { alert("A campanha não iniciou. Feche e reabra o aplicativo."); }
  };
  const settings = useSelector((state: RootState) => state.settings);
  const connection = useSelector((state: RootState) => state.connection);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const hideScrollbar = useHideScrollbar(scrollRef);

  return (
    <Box component="nav" sx={{ width: drawerWidth, flexShrink: 0 }}>
      <Drawer
        variant="permanent"
        sx={{
          "& .MuiDrawer-paper": {
            boxSizing: "border-box",
            width: drawerWidth,
            border: "none",
            bgcolor: "background.default",
            overflowY: "initial",
          },
        }}
        open
      >
        <Toolbar
          sx={{
            justifyContent: showWindowControls ? "space-between" : "end",
            bgcolor: "background.paper",
            px: 1,
            WebkitAppRegion: "drag",
            minHeight: "52px",
          }}
          disableGutters
          variant="dense"
          onDoubleClick={(e) =>
            e.target === e.currentTarget && window.kenku.toggleMaximize()
          }
        >
          {showWindowControls && (
            <Box sx={{ width: "36px", height: "36px", m: 1 }}>
              <img src={icon} />
            </Box>
          )}
          <IconButton
            onClick={() => setSettingsOpen(true)}
            sx={{ WebkitAppRegion: "no-drag" }}
          >
            <SettingsIcon />
          </IconButton>
          <Settings
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </Toolbar>
        <Box sx={{ overflowY: "auto" }} ref={scrollRef} {...hideScrollbar}>
          <Stack>
            <Button onClick={openCampaign} sx={{m: 1, justifyContent: "start"}}>◈ Minha campanha</Button>
            <Typography variant="caption" sx={{mx: 2, mb: 1}}>Mesa do Mestre · áudio baseado no Kenku FM</Typography>
            <BookmarkListItems />
            {settings.externalInputsEnabled && <InputListItems />}
            <OutputListItems />
            {connection.status === "disconnected" && (
              <Typography variant="caption" align="center" marginY={2}>
                Connect{" "}
                <Link
                  component="button"
                  variant="caption"
                  onClick={() => setSettingsOpen(true)}
                >
                  Discord
                </Link>{" "}
                for more outputs
              </Typography>
            )}
          </Stack>
        </Box>
      </Drawer>
    </Box>
  );
}
